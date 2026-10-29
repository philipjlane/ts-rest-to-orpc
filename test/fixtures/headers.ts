import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

export const contract = c.router(
  {
    me: {
      method: "GET",
      path: "/me",
      headers: z.object({ "x-request-id": z.string().optional() }),
      responses: { 200: z.object({ id: z.string() }) },
    },
    legacyHeaders: {
      method: "GET",
      path: "/legacy",
      headers: {
        "x-legacy": z.string(),
        authorization: z.string(),
      },
      responses: { 200: z.string() },
    },
    noHeaders: {
      method: "POST",
      path: "/things/:thingId",
      body: z.object({ name: z.string() }),
      contentType: "multipart/form-data",
      responses: { 200: z.string() },
    },
  },
  {
    baseHeaders: z.object({ authorization: z.string() }),
    metadata: { service: "things" },
  },
);
