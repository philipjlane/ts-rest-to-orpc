import { initContract } from '@ts-rest/core'
import { Post } from './schemas'

const c = initContract()

export const contract = c.router({
  getPost: {
    method: 'GET',
    path: '/posts/:id',
    responses: { 200: Post },
  },
})
