import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      role: string
      isSuperAdmin: boolean
      isFreeUser: boolean
      isSpecialUser: boolean
    } & DefaultSession["user"]
  }

  interface User {
    role: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: string
    id: string
    isSuperAdmin?: boolean
    isFreeUser?: boolean
    isSpecialUser?: boolean
  }
}
