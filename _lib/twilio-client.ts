import twilio, { Twilio } from "twilio";
import { runtime } from "./runtime";

/**
 * Builds a Twilio client from an API Key/Secret pair.
 *
 * Every operation these actions perform is reachable with key-based auth, so no
 * Account SID is required. The SDK insists on one being present, hence the
 * placeholder — it is never sent as part of a request.
 */
export function createTwilioClient(): Twilio {
  const apiKey = runtime.requireInput("TWILIO_API_KEY");
  const apiSecret = runtime.requireInput("TWILIO_API_SECRET", true);

  return twilio(apiKey, apiSecret, { accountSid: "AC0" });
}
