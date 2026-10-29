const PARAM_PATTERN = /:([A-Za-z_$][A-Za-z0-9_$]*)(\?)?/g

export interface ConvertedPath {
  path: string
  params: string[]
  /** Params written as `:name?`; oRPC has no optional path params. */
  optionalParams: string[]
}

/** Convert a ts-rest path (`/posts/:id`) to an oRPC path (`/posts/{id}`). */
export function convertPath(tsRestPath: string): ConvertedPath {
  const params: string[] = []
  const optionalParams: string[] = []
  const path = tsRestPath.replace(PARAM_PATTERN, (_match, name: string, optional: string | undefined) => {
    params.push(name)
    if (optional) optionalParams.push(name)
    return `{${name}}`
  })
  return { path, params, optionalParams }
}
