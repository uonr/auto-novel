import { jwtDecode } from 'jwt-decode';

export type UserRole = 'admin' | 'trusted' | 'member' | 'restricted' | 'banned';

export interface UserProfile {
  token: string;
  username: string;
  role: UserRole;
  createdAt: number;
  expiredAt: number;
  issuedAt: number;
}

export interface UserData {
  profile?: UserProfile;
  adminMode: boolean;
}

export function parseJwt(token: string): UserProfile {
  const { sub, exp, role, iat, crat } = jwtDecode<{
    sub: string;
    exp: number;
    iat: number;
    role: UserRole;
    crat: number;
  }>(token);
  return {
    token,
    username: sub,
    role,
    issuedAt: iat,
    createdAt: crat,
    expiredAt: exp,
  };
}
