import type { Comment1 } from '@/model/Comment';
import type { Page } from '@/model/Page';
import { client } from './client';

const listComment = (params: {
  site: string;
  page: number;
  parentId?: string;
  pageSize: number;
}) => client.get('comment', { searchParams: params }).json<Page<Comment1>>();

// 评论接口只返回页数，用每页一条的方式换算出评论数（不含楼中楼回复）
const countComment = (site: string) =>
  client
    .get('comment', { searchParams: { site, page: 0, pageSize: 1 } })
    .json<Page<Comment1>>()
    .then((page) => page.pageNumber);

const createComment = (json: {
  site: string;
  parent: string | undefined;
  content: string;
}) => client.post('comment', { json });

const deleteComment = (id: string) => client.delete(`comment/${id}`);
const hideComment = (id: string) => client.put(`comment/${id}/hidden`);
const unhideComment = (id: string) => client.delete(`comment/${id}/hidden`);

export const CommentApi = {
  listComment,
  countComment,
  createComment,
  deleteComment,
  hideComment,
  unhideComment,
};
