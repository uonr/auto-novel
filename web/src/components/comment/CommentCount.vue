<script lang="ts" setup>
import { CommentRepo } from '@/repos';

const props = defineProps<{
  site: string;
}>();

const { data: count } = CommentRepo.useCommentCount(() => props.site);
</script>

<template>
  <slot v-if="count" :count="count" />
</template>
