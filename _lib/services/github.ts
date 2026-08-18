import { getOctokit } from "@actions/github";
import { runtime } from "../runtime";

/** Regular file mode, the only mode these commits ever create. */
const FILE_MODE = "100644" as const;

export interface FileToCommit {
  path: string;
  content: string;
}

export interface GithubService {
  readFile(path: string, ref: string): Promise<string>;
  /** Creates a branch containing the given files as a single commit. */
  commitToNewBranch(files: FileToCommit[], branch: string, message: string): Promise<void>;
  openPullRequest(branch: string, title: string, body: string): Promise<string>;
}

function repositoryParts(): { owner: string; repo: string } {
  const slug = process.env.GITHUB_REPOSITORY;
  if (!slug?.includes("/")) {
    runtime.fail("GITHUB_REPOSITORY is not set; this step must run inside GitHub Actions.");
  }
  const [owner, repo] = slug.split("/");
  return { owner, repo };
}

export function createGithubService(token: string): GithubService {
  const api = getOctokit(token).rest;
  const { owner, repo } = repositoryParts();

  return {
    async readFile(path, ref) {
      runtime.debug(`GitHub: reading ${path} at ${ref}`);
      try {
        const response = await api.repos.getContent({ owner, repo, path, ref });
        const payload = response.data as { content?: string };
        if (!payload.content) {
          runtime.fail(`'${path}' did not return file content; is it a directory?`);
        }
        return Buffer.from(payload.content, "base64").toString("utf8");
      } catch (error) {
        runtime.fail(`Could not read '${path}' from the repository: ${(error as Error).message}`);
      }
    },

    /**
     * Builds the commit through the git data API rather than the contents API, so
     * every file lands in one commit and one tree regardless of how many there
     * are. The tree is based on the commit under test, which keeps unrelated
     * files intact.
     */
    async commitToNewBranch(files, branch, message) {
      const headSha = process.env.GITHUB_SHA;
      if (!headSha) runtime.fail("GITHUB_SHA is not set; cannot determine the base commit.");

      runtime.debug(`GitHub: committing ${files.length} file(s) to ${branch}`);

      const base = await api.git.getCommit({ owner, repo, commit_sha: headSha });

      const tree = await api.git.createTree({
        owner,
        repo,
        base_tree: base.data.tree.sha,
        tree: files.map((file) => ({ path: file.path, mode: FILE_MODE, content: file.content })),
      });

      const actor = process.env.GITHUB_ACTOR ?? "github-actions";
      const commit = await api.git.createCommit({
        owner,
        repo,
        message,
        tree: tree.data.sha,
        parents: [headSha],
        author: { name: actor, email: `${actor}@users.noreply.github.com` },
      });

      await api.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: commit.data.sha,
      });

      runtime.debug(`GitHub: created ${commit.data.sha} on refs/heads/${branch}`);
    },

    async openPullRequest(branch, title, body) {
      const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_REF_NAME } = process.env;
      const runLink = `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;

      const pullRequest = await api.pulls.create({
        owner,
        repo,
        head: branch,
        base: GITHUB_REF_NAME!,
        title,
        body: `${body}\n\nGenerated from run: <${runLink}>`,
      });

      runtime.info(`Opened pull request: ${pullRequest.data.html_url}`);
      return pullRequest.data.html_url;
    },
  };
}
