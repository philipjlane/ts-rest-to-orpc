// Diagnostics:
// warn L6 [metadata-v2] Router-level `metadata` was dropped; oRPC v2 `.meta()` only accepts plugin-defined metadata.
// info L6 [base-headers-inlined] baseHeaders were merged into the headers of every inline route.
// info L23 [content-type] Dropped `contentType: multipart/form-data`; oRPC sends multipart automatically when the body schema contains a File or Blob.

import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { z } from "zod";

export const contract = {
  me: oc
    .meta(openapi({ method: "GET", path: "/me", inputStructure: "detailed" }))
    .input(z.object({
      headers: z.object({ authorization: z.string() }).extend(z.object({ "x-request-id": z.string().optional() }).shape),
    }))
    .output(z.object({ id: z.string() })),
  legacyHeaders: oc
    .meta(openapi({ method: "GET", path: "/legacy", inputStructure: "detailed" }))
    .input(z.object({
      headers: z.object({ authorization: z.string() }).extend(z.object({
        "x-legacy": z.string(),
        authorization: z.string(),
      }).shape),
    }))
    .output(z.string()),
  noHeaders: oc
    .meta(openapi({ method: "POST", path: "/things/{thingId}", inputStructure: "detailed" }))
    .input(z.object({
      params: z.object({
        thingId: z.string(),
      }),
      headers: z.object({ authorization: z.string() }),
      body: z.object({ name: z.string() }),
    }))
    .output(z.string()),
};
