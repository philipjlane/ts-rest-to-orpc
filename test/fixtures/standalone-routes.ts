import { initContract, type AppRoute, type AppRouter } from '@ts-rest/core'
import { z } from 'zod'

const c = initContract()

const User = z.object({ id: z.number(), name: z.string() })

export const getUser = {
  method: 'GET',
  path: '/users/:id',
  responses: { 200: User, 404: z.object({ message: z.string() }) },
} satisfies AppRoute

export const listUsers = c.query({
  method: 'GET',
  path: '/users',
  query: z.object({ q: z.string().optional() }),
  responses: { 200: z.array(User) },
})

export const updateUser = c.mutation({
  method: 'PATCH',
  path: '/users/:id',
  pathParams: z.object({ id: z.coerce.number() }),
  body: User.partial(),
  responses: { 200: User },
})

export const userRoutes = {
  getUser,
  listUsers,
  updateUser,
  stats: {
    method: 'GET',
    path: '/users/stats',
    responses: { 200: z.object({ count: z.number() }) },
  },
} as const satisfies AppRouter

export const contract = c.router(userRoutes)

export type Contract = typeof contract
export const isRouter = (x: AppRouter): x is AppRouter => typeof x === 'object'
