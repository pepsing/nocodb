<script setup lang="ts">
import type { ProjectFolderType } from '~/lib/types'

const props = defineProps<{
  modelValue: boolean
  baseId: string
  sourceId: string
  parentId?: string | null
}>()

const emits = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'created', value: ProjectFolderType): void
}>()

const dialogShow = useVModel(props, 'modelValue', emits)

const { t } = useI18n()

const { createProjectFolder } = useTablesStore()

const inputEl = ref<HTMLInputElement>()
const title = ref('')
const isCreating = ref(false)

watch(
  dialogShow,
  (isOpen) => {
    if (!isOpen) return

    title.value = ''

    nextTick(() => {
      inputEl.value?.focus()
    })
  },
  { immediate: true },
)

const onSubmit = async () => {
  const nextTitle = title.value.trim()

  if (!nextTitle) {
    message.error(t('msg.error.nameRequired'))
    return
  }

  try {
    isCreating.value = true

    const folder = await createProjectFolder({
      baseId: props.baseId,
      sourceId: props.sourceId,
      parentId: props.parentId,
      title: nextTitle,
    })

    emits('created', folder)
    dialogShow.value = false
  } catch (e: any) {
    message.error(await extractSdkResponseErrorMsg(e))
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <NcModal
    v-model:visible="dialogShow"
    size="xs"
    height="auto"
    :centered="false"
    nc-modal-class-name="!p-0"
    class="!top-[25vh]"
    wrap-class-name="nc-modal-project-folder-create-wrapper"
    :mask-closable="!isCreating"
    @keydown.esc="dialogShow = false"
  >
    <div class="py-5 flex flex-col gap-5">
      <div class="px-5 flex flex-row items-center gap-x-2 text-base font-semibold text-nc-content-gray">
        <GeneralIcon icon="ncFolderPlus" class="!text-nc-content-gray-subtle2 w-5 h-5" />
        {{ $t('activity.createFolder') }}
      </div>

      <a-form layout="vertical" class="!px-5 flex flex-col gap-5" @keydown.enter="onSubmit" @keydown.esc="dialogShow = false">
        <a-form-item class="relative nc-table-input-wrapper relative">
          <a-input
            ref="inputEl"
            v-model:value="title"
            class="nc-table-input nc-input-sm nc-input-shadow"
            hide-details
            :placeholder="$t('labels.newFolder')"
            data-testid="create-folder-title-input"
          />
        </a-form-item>

        <div class="flex flex-row items-center justify-between gap-x-2">
          <div></div>
          <div class="flex gap-2 items-center">
            <NcButton type="secondary" size="small" :disabled="isCreating" @click="dialogShow = false">
              {{ $t('general.cancel') }}
            </NcButton>

            <NcButton size="small" :loading="isCreating" @click="onSubmit">
              {{ $t('activity.createFolder') }}
            </NcButton>
          </div>
        </div>
      </a-form>
    </div>
  </NcModal>
</template>

<style lang="scss">
.nc-modal-wrapper.nc-modal-project-folder-create-wrapper {
  .ant-modal-content {
    border-radius: 1.25rem !important;
  }
}
</style>
