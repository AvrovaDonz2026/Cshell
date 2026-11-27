import { apiRequest } from './client'
import type { User } from './types'

export function fetchProfile(): Promise<User> {
  return apiRequest<User>('/user/profile')
}

export function updateProfile(input: { username: string }): Promise<User> {
  return apiRequest<User>('/user', {
    method: 'PUT',
    body: input,
  })
}

export function updatePassword(input: {
  old_password: string
  new_password: string
}): Promise<unknown> {
  return apiRequest('/user/password', {
    method: 'PUT',
    body: input,
  })
}
