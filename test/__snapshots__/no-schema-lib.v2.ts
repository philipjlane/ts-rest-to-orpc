// Diagnostics:


import { oc, type } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { Post } from './schemas'

export const contract = {
  getPost: oc
    .meta(openapi({ method: 'GET', path: '/posts/{id}' }))
    .input(type<{ id: string }>())
    .output(Post),
}
