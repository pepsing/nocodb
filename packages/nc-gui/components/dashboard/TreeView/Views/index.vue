<script setup lang="ts">
withDefaults(
  defineProps<{
    level?: number
  }>(),
  {
    level: 0,
  },
)
</script>

<template>
  <DashboardTreeViewViewsList :level="level" />
</template>
