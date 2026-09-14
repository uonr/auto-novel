import type { UserData } from './jwt';
import { parseJwt } from './jwt';

// 开发环境自动登录用的 Access Token。
//
// 这是一份真实可用的登录凭证，不要提交到仓库。
// 也可以改用 VITE_DEV_AUTH_TOKEN 环境变量（写在 web/.env.local 里），优先级更高。
//
// Access Token 有效期约2小时。过期后如果浏览器里没有刷新用的 Cookie，
// 需要重新登录一次，从 localStorage 的 auth 里复制新的 token 到这里。
const FallbackToken =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJuYW1vbmVubyIsImF1ZCI6WyJuIl0sImV4cCI6MTc4ODE0ODM4MSwiaWF0IjoxNzg4MTQxMTgxLCJ1aWQiOjEzOTkzLCJyb2xlIjoibWVtYmVyIiwiY3JhdCI6MTcyMDgwOTIxMH0.P3Ugc3Zf9exFvk_bGGXuOw7MILHpqklZmb50luKtNqU';

// 开发环境下，如果本地没有登录态（没登录过，或者存着的 token 已经过期），
// 就用上面的 token 顶上。已有登录态时不覆盖，刷新拿到的新 token 优先。
export function applyDevAuth(userData: UserData) {
  if (userData.profile) return;

  const token = import.meta.env.VITE_DEV_AUTH_TOKEN || FallbackToken;
  if (!token) return;

  let profile;
  try {
    profile = parseJwt(token);
  } catch (e) {
    console.warn('[dev-auth] token 解析失败：' + e);
    return;
  }

  if (Date.now() > profile.expiredAt * 1000) {
    console.warn(
      '[dev-auth] token 已于 ' +
        new Date(profile.expiredAt * 1000).toLocaleString() +
        ' 过期，需要重新复制一份',
    );
    return;
  }

  userData.profile = profile;
  console.info(
    `[dev-auth] 已自动登录：${profile.username}（${profile.role}），` +
      `token 有效期至 ${new Date(profile.expiredAt * 1000).toLocaleString()}`,
  );
}
