// Diagnostics:
// info L6 [metadata-inlined] Router-level `metadata` was merged into the `.meta()` of every inline route.
// info L6 [base-headers-inlined] baseHeaders were merged into the headers of every inline route.
// warn L8 [input-forced-detailed] Input uses `inputStructure: 'detailed'` because `headers` cannot be merged into a compact input.
// warn L14 [input-forced-detailed] Input uses `inputStructure: 'detailed'` because `headers` cannot be merged into a compact input.
// warn L23 [input-forced-detailed] Input uses `inputStructure: 'detailed'` because `headers` cannot be merged into a compact input.
// info L23 [content-type] Dropped `contentType: multipart/form-data`; oRPC sends multipart automatically when the body schema contains a File or Blob.

import { oc } from "@orpc/contract";
import { z } from "zod";

export const contract = {
  // TODO(ts-rest-to-orpc): Input uses `inputStructure: 'detailed'` because `headers` cannot be merged into a compact input.
  me: oc
    .meta({ service: "things" })
    .route({ method: "GET", path: "/me", inputStructure: "detailed" })
    .input(z.object({
      headers: z.object({ authorization: z.string() }).extend(z.object({ "x-request-id": z.string().optional() }).shape),
    }))
    .output(z.object({ id: z.string() })),
  // TODO(ts-rest-to-orpc): Input uses `inputStructure: 'detailed'` because `headers` cannot be merged into a compact input.
  legacyHeaders: oc
    .meta({ service: "things" })
    .route({ method: "GET", path: "/legacy", inputStructure: "detailed" })
    .input(z.object({
      headers: z.object({ authorization: z.string() }).extend(z.object({
        "x-legacy": z.string(),
        authorization: z.string(),
      }).shape),
    }))
    .output(z.string()),
  // TODO(ts-rest-to-orpc): Input uses `inputStructure: 'detailed'` because `headers` cannot be merged into a compact input.
  noHeaders: oc
    .meta({ service: "things" })
    .route({ method: "POST", path: "/things/{thingId}", inputStructure: "detailed" })
    .input(z.object({
      params: z.object({
        thingId: z.string(),
      }),
      headers: z.object({ authorization: z.string() }),
      body: z.object({ name: z.string() }),
    }))
    .output(z.string()),
};
