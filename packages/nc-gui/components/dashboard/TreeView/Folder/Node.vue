<script setup lang="ts">
import type { BaseType } from 'nocodb-sdk'
import TableNode from '../Table/Node.vue'
import type { ProjectFolderType, SidebarTableNode } from '~/lib/types'

defineOptions({
  name: 'DashboardTreeViewFolderNode',
})

const props = withDefaults(
  defineProps<{
    base: BaseType
    folder: ProjectFolderType
    folders: FolderTreeNode[]
    tables: SidebarTableNode[]
    sourceIndex: number
    level?: number
  }>(),
  {
    level: 0,
  },
)

interface FolderTreeNode extends ProjectFolderType {
  folders: FolderTreeNode[]
  tables: SidebarTableNode[]
}

const emits = defineEmits(['createFolder', 'createTable', 'renameFolder', 'deleteFolder'])

const { base, folder, sourceIndex, level } = toRefs(props)

const { t } = useI18n()

const { isUIAllowed } = useRoles()

const baseRole = inject(ProjectRoleInj)

const source = computed(() => base.value?.sources?.[sourceIndex.value])

const isExpanded = ref(true)
const isOptionsOpen = ref(false)
const isEditing = ref(false)
const input = ref<HTMLInputElement>()
const title = ref(folder.value.title)

const nodePaddingLeft = computed(() => `${(sourceIndex.value === 0 ? 8 : 32) + level.value * 16}px`)

const canCreateTable = computed(() => isUIAllowed('tableCreate', { roles: baseRole?.value, source: source.value }))
const canRename = computed(() => isUIAllowed('tableRename', { roles: baseRole?.value, source: source.value }))
const canDelete = computed(() => isUIAllowed('tableDelete', { roles: baseRole?.value, source: source.value }))

watch(
  () => folder.value.title,
  (newTitle) => {
    if (!isEditing.value) title.value = newTitle
  },
)

function onCreateFolder(parentId = folder.value.id) {
  isOptionsOpen.value = false
  isExpanded.value = true
  emits('createFolder', parentId)
}

function onCreateTable(folderId = folder.value.id) {
  isOptionsOpen.value = false
  isExpanded.value = true
  emits('createTable', folderId)
}

function onRenameMenuClick() {
  if (!canRename.value) return

  isOptionsOpen.value = false
  isEditing.value = true
  title.value = folder.value.title

  nextTick(() => {
    input.value?.focus()
    input.value?.select()
  })
}

function onCancelRename() {
  isEditing.value = false
  title.value = folder.value.title
}

function onRename() {
  if (!isEditing.value) return

  const nextTitle = title.value.trim()
  if (!nextTitle || nextTitle === folder.value.title) {
    onCancelRename()
    return
  }

  emits('renameFolder', {
    folder: folder.value,
    title: nextTitle,
  })
  isEditing.value = false
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopImmediatePropagation()
    event.preventDefault()
    onCancelRename()
  } else if (event.key === 'Enter') {
    event.stopImmediatePropagation()
    event.preventDefault()
    onRename()
  }
}

function onDeleteFolder() {
  isOptionsOpen.value = false

  if (props.folders.length || props.tables.length) {
    message.error('Folder must be empty before deletion')
    return
  }

  emits('deleteFolder', folder.value)
}
</script>

<template>
  <div class="nc-folder-node-wrapper select-none w-full bg-inherit" :data-folder-id="folder.id" data-tree-node-type="folder">
    <div
      class="flex-none flex-1 folder-context flex items-center gap-1 h-full nc-tree-item-inner nc-sidebar-node pr-0.75 mb-0.25 rounded-md h-7 w-full group cursor-pointer hover:bg-nc-bg-gray-medium text-bodyDefaultSm font-medium"
      :style="{ paddingLeft: nodePaddingLeft }"
      :data-testid="`nc-folder-side-node-${folder.title}`"
      @click="isExpanded = !isExpanded"
    >
      <NcButton
        type="text"
        size="xxsmall"
        class="!w-6 !h-6 flex-none !rounded-md text-nc-content-gray-subtle2 hover:text-nc-content-gray"
        @click.stop="isExpanded = !isExpanded"
      >
        <GeneralIcon
          icon="chevronRight"
          class="cursor-pointer transform transition-transform duration-200 !text-current text-[16px]"
          :class="{ '!rotate-90': isExpanded }"
        />
      </NcButton>

      <GeneralIcon
        :icon="isExpanded ? 'ncFolderOpen' : 'ncFolderClosed'"
        class="flex-none !w-4 !h-4 text-nc-content-gray-muted"
      />

      <a-input
        v-if="isEditing"
        ref="input"
        v-model:value="title"
        class="!bg-transparent !pr-1.5 !flex-1 mr-4 !rounded-md !h-6 animate-sidebar-node-input-padding"
        @click.stop
        @blur="onRename"
        @keydown.stop="onKeyDown($event)"
      />

      <NcTooltip v-else class="nc-sidebar-node-title text-ellipsis overflow-hidden select-none !flex-1" show-on-truncate-only>
        <template #title>{{ folder.title }}</template>
        <span
          class="text-nc-content-gray-subtle"
          :style="{ wordBreak: 'keep-all', whiteSpace: 'nowrap', display: 'inline' }"
          @dblclick.stop="onRenameMenuClick"
        >
          {{ folder.title }}
        </span>
      </NcTooltip>

      <NcDropdown v-model:visible="isOptionsOpen" :trigger="['click']" @click.stop>
        <NcButton
          class="nc-sidebar-node-btn !opacity-100 !inline-block text-nc-content-gray-subtle hover:text-nc-content-gray"
          :class="{ '!opacity-100 !inline-block': isOptionsOpen }"
          type="text"
          size="xxsmall"
          @click.stop
        >
          <MdiDotsHorizontal class="!text-current" />
        </NcButton>

        <template #overlay>
          <NcMenu class="!min-w-50" variant="small">
            <NcMenuItem v-if="canCreateTable" @click="onCreateFolder()">
              <GeneralIcon icon="ncFolderPlus" />
              {{ $t('labels.newFolder') }}
            </NcMenuItem>

            <NcMenuItem v-if="canCreateTable" @click="onCreateTable()">
              <GeneralIcon icon="table" />
              {{ $t('objects.table') }}
            </NcMenuItem>

            <NcDivider v-if="canRename || canDelete" />

            <NcMenuItem v-if="canRename" @click="onRenameMenuClick">
              <GeneralIcon icon="rename" />
              {{ $t('general.rename') }}
            </NcMenuItem>

            <NcMenuItem v-if="canDelete" @click="onDeleteFolder">
              <GeneralIcon icon="delete" />
              {{ $t('labels.deleteFolder') }}
            </NcMenuItem>
          </NcMenu>
        </template>
      </NcDropdown>
    </div>

    <div v-if="isExpanded">
      <DashboardTreeViewFolderNode
        v-for="child of folders"
        :key="child.id"
        :base="base"
        :folder="child"
        :folders="child.folders"
        :tables="child.tables"
        :source-index="sourceIndex"
        :level="level + 1"
        @create-folder="emits('createFolder', $event)"
        @create-table="emits('createTable', $event)"
        @rename-folder="emits('renameFolder', $event)"
        @delete-folder="emits('deleteFolder', $event)"
      />

      <TableNode
        v-for="table of tables"
        :key="table.id"
        class="nc-tree-item text-sm"
        :data-order="table.order"
        :data-id="table.id"
        :table="table"
        :base="base"
        :source-index="sourceIndex"
        :level="level + 1"
        :data-title="table.title"
        :data-source-id="source?.id"
        :data-type="table.type"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.nc-folder-node-wrapper {
  &:hover {
    .nc-sidebar-node-btn {
      @apply !opacity-100 !inline-block;
    }
  }
}
</style>
