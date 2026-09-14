import { useQuery } from '@pinia/colada';

import { CommentApi } from '@/api';
import type { Comment1 } from '@/model/Comment';
import type { Page } from '@/model/Page';
import { cache, withOnSuccess } from './cache';

const ListKey = 'comment-list';
const CountKey = 'comment-count';

const useCommentList = (
  page: MaybeRefOrGetter<number>,
  site: MaybeRefOrGetter<string>,
  parentId: MaybeRefOrGetter<string | undefined> = undefined,
  initialData: Page<Comment1> | undefined = undefined,
) =>
  useQuery({
    key: () => [ListKey, toValue(site), toValue(parentId) ?? '', toValue(page)],
    query: () =>
      CommentApi.listComment({
        page: toValue(page) - 1,
        pageSize: 10,
        site: toValue(site),
        ...(toValue(parentId) ? { parentId: toValue(parentId) } : {}),
      }),
    initialData: () => initialData,
  });

const useCommentCount = (site: MaybeRefOrGetter<string>) =>
  useQuery({
    key: () => [CountKey, toValue(site)],
    query: () => CommentApi.countComment(toValue(site)),
    staleTime: 5 * 60 * 1000,
  });

export const CommentRepo = {
  useCommentList,
  useCommentCount,

  createComment: withOnSuccess(CommentApi.createComment, (_, comment) => {
    cache.invalidateQueries({
      key: [ListKey, comment.site, comment.parent ?? ''],
    });
    cache.invalidateQueries({ key: [CountKey, comment.site] });
  }),
  deleteComment: (id: string, site: string, parentId?: string) =>
    CommentApi.deleteComment(id).then(() => {
      cache.invalidateQueries({ key: [ListKey, site, parentId ?? ''] });
      cache.invalidateQueries({ key: [CountKey, site] });
    }),
  hideComment: CommentApi.hideComment,
  unhideComment: CommentApi.unhideComment,
};
