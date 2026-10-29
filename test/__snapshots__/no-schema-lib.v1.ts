// Diagnostics:


import { oc, type } from '@orpc/contract'
import { Post } from './schemas'

export const contract = {
  getPost: oc
    .route({ method: 'GET', path: '/posts/{id}' })
    .input(type<{ id: string }>())
    .output(Post),
}
