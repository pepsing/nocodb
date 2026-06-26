<script setup lang="ts">
import type { BaseType, TableType } from 'nocodb-sdk'
import Sortable from 'sortablejs'
import FolderNode from '../Folder/Node.vue'
import TableNode from './Node.vue'
import DlgProjectFolderCreate from '~/components/dlg/ProjectFolder/Create.vue'
import type { ProjectFolderType, SidebarTableNode } from '~/lib/types'

interface FolderTreeNode extends ProjectFolderType {
  folders: FolderTreeNode[]
  tables: SidebarTableNode[]
}

const props = withDefaults(
  defineProps<{
    base: BaseType
    baseId: string
    sourceIndex?: number
    showCreateTableBtn?: boolean
  }>(),
  {
    sourceIndex: 0,
    showCreateTableBtn: false,
  },
)

const emits = defineEmits(['createTable'])

const base = toRef(props, 'base')
const sourceIndex = toRef(props, 'sourceIndex')

const source = computed(() => base.value?.sources?.[sourceIndex.value])

const { isMobileMode } = useGlobal()

const { isUIAllowed } = useRoles()

const { openedProject, baseHomeSearchQuery } = storeToRefs(useBases())

const tablesStore = useTablesStore()
const { baseTables, baseFolders } = storeToRefs(tablesStore)
const { updateProjectFolder, deleteProjectFolder } = tablesStore
const tables = computed(() => baseTables.value.get(base.value.id!) ?? [])
const folders = computed(() => baseFolders.value.get(base.value.id!) ?? [])

const availableTables = computed(() => {
  const currentSourceId = source.value?.id
  if (!currentSourceId) return []

  return tables.value.filter((table) => table.source_id === currentSourceId)
})

const availableFolders = computed(() => {
  const currentSourceId = source.value?.id

  return folders.value.filter((folder) => folder.source_id === currentSourceId || (!folder.source_id && sourceIndex.value === 0))
})

const { viewsByTable } = storeToRefs(useViewsStore())

const { $api } = useNuxtApp()

const tablesById = computed(() =>
  tables.value.reduce<Record<string, SidebarTableNode>>((acc, table) => {
    acc[table.id!] = table

    return acc
  }, {}),
)

const keys = ref<Record<string, number>>({})

const menuRefs = ref<HTMLElement[] | HTMLElement>()

const sortables: Record<string, Sortable> = {}

// todo: replace with vuedraggable
const initSortable = (el: Element) => {
  const source_id = el.getAttribute('nc-source')
  if (!source_id) return
  if (isMobileMode.value) return
  if (availableFolders.value.length) return

  if (sortables[source_id]) sortables[source_id].destroy()
  Sortable.create(el as HTMLLIElement, {
    onEnd: async (evt) => {
      const offset = tables.value.findIndex((table) => table.source_id === source_id)

      const { newIndex = 0, oldIndex = 0 } = evt

      if (newIndex === oldIndex) return

      const itemEl = evt.item as HTMLLIElement
      const item = tablesById.value[itemEl.dataset.id as string]
      if (!item) return

      // get the html collection of all list items
      const children: HTMLCollection = evt.to.children

      // skip if children count is 1
      if (children.length < 2) return

      // get items before and after the moved item
      const itemBeforeEl = children[newIndex - 1] as HTMLLIElement
      const itemAfterEl = children[newIndex + 1] as HTMLLIElement

      // get items meta of before and after the moved item
      const itemBefore = itemBeforeEl && tablesById.value[itemBeforeEl.dataset.id as string]
      const itemAfter = itemAfterEl && tablesById.value[itemAfterEl.dataset.id as string]

      // set new order value based on the new order of the items
      if (children.length - 1 === evt.newIndex) {
        if (!itemBefore) return
        item.order = (itemBefore.order as number) + 1
      } else if (newIndex === 0) {
        if (!itemAfter) return
        item.order = (itemAfter.order as number) / 2
      } else {
        if (!itemBefore || !itemAfter) return
        item.order = ((itemBefore.order as number) + (itemAfter.order as number)) / 2
      }

      // update the order of the moved item
      tables.value?.splice(newIndex + offset, 0, ...tables.value?.splice(oldIndex + offset, 1))

      // force re-render the list
      if (keys.value[source_id]) {
        keys.value[source_id] = keys.value[source_id] + 1
      } else {
        keys.value[source_id] = 1
      }

      // update the item order
      await $api.internal.postOperation(
        base.value.fk_workspace_id!,
        base.value.id!,
        {
          operation: 'tableReorder',
          tableId: item.id as string,
        },
        {
          order: item.order,
        },
      )
    },
    animation: 150,
    setData(dataTransfer, dragEl) {
      dataTransfer.setData(
        'text/json',
        JSON.stringify({
          id: dragEl.dataset.id,
          title: dragEl.dataset.title,
          type: dragEl.dataset.type,
          sourceId: dragEl.dataset.sourceId,
        }),
      )
    },
    revertOnSpill: true,
    filter: isTouchEvent,
    ...getDraggableAutoScrollOptions({ scrollSensitivity: 50 }),
  })
}

watchEffect(() => {
  if (availableFolders.value.length) {
    Object.values(sortables).forEach((sortable) => sortable.destroy())
    for (const sourceId of Object.keys(sortables)) {
      delete sortables[sourceId]
    }
    return
  }

  if (menuRefs.value && isUIAllowed('viewCreateOrEdit')) {
    if (menuRefs.value instanceof HTMLElement) {
      initSortable(menuRefs.value)
    } else {
      menuRefs.value.forEach((el) => initSortable(el))
    }
  }
})

const folderOrTableSort = (a: ProjectFolderType | SidebarTableNode, b: ProjectFolderType | SidebarTableNode) => {
  const orderA = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER
  const orderB = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER

  if (orderA !== orderB) return orderA - orderB

  return `${a.title || ''}`.localeCompare(`${b.title || ''}`)
}

const tableMatchesSearch = (table: TableType) => {
  if (!baseHomeSearchQuery.value) return true

  if (searchCompare(table.title, baseHomeSearchQuery.value)) return true
  if (!table.base_id || !table.id) return false
  const key = `${table.base_id}:${table.id}`
  return viewsByTable.value.get(key)?.some((view) => searchCompare(view.title, baseHomeSearchQuery.value)) ?? false
}

const tableTree = computed(() => {
  const folderMap = new Map<string, FolderTreeNode>()
  const rootFolders: FolderTreeNode[] = []
  const rootTables: SidebarTableNode[] = []

  for (const folder of availableFolders.value) {
    folderMap.set(folder.id, {
      ...folder,
      folders: [],
      tables: [],
    })
  }

  for (const folder of folderMap.values()) {
    if (folder.fk_parent_id && folderMap.has(folder.fk_parent_id)) {
      folderMap.get(folder.fk_parent_id)!.folders.push(folder)
    } else {
      rootFolders.push(folder)
    }
  }

  for (const table of availableTables.value) {
    const folderId = table.fk_folder_id

    if (folderId && folderMap.has(folderId)) {
      folderMap.get(folderId)!.tables.push(table)
    } else {
      rootTables.push(table)
    }
  }

  const sortFolder = (folder: FolderTreeNode) => {
    folder.folders.sort(folderOrTableSort)
    folder.tables.sort(folderOrTableSort)
    folder.folders.forEach(sortFolder)
  }

  rootFolders.sort(folderOrTableSort)
  rootFolders.forEach(sortFolder)
  rootTables.sort(folderOrTableSort)

  return {
    folders: rootFolders,
    rootTables,
  }
})

const filteredTableTree = computed(() => {
  if (!baseHomeSearchQuery.value) return tableTree.value

  const filterFolder = (folder: FolderTreeNode): FolderTreeNode | null => {
    const childFolders = folder.folders.map(filterFolder).filter((child): child is FolderTreeNode => !!child)
    const childTables = folder.tables.filter(tableMatchesSearch)

    if (searchCompare(folder.title, baseHomeSearchQuery.value) || childFolders.length || childTables.length) {
      return {
        ...folder,
        folders: childFolders,
        tables: childTables,
      }
    }

    return null
  }

  return {
    folders: tableTree.value.folders.map(filterFolder).filter((folder): folder is FolderTreeNode => !!folder),
    rootTables: tableTree.value.rootTables.filter(tableMatchesSearch),
  }
})

const availableNodeCount = computed(() => availableTables.value.length + availableFolders.value.length)

const visibleNodeCount = computed(() => filteredTableTree.value.folders.length + filteredTableTree.value.rootTables.length)

const createFolder = async (parentId?: string | null) => {
  if (!base.value?.id || !source.value?.id) return

  const isOpen = ref(true)

  const { close } = useDialog(DlgProjectFolderCreate, {
    'modelValue': isOpen,
    'baseId': base.value.id,
    'sourceId': source.value.id,
    'parentId': parentId,
    'onUpdate:modelValue': closeDialog,
  })

  function closeDialog() {
    isOpen.value = false

    close(1000)
  }
}

const renameFolder = async ({ folder, title }: { folder: ProjectFolderType; title: string }) => {
  if (!base.value?.id) return

  try {
    await updateProjectFolder({
      baseId: base.value.id,
      folderId: folder.id,
      title,
    })
  } catch (e: any) {
    message.error(await extractSdkResponseErrorMsg(e))
  }
}

const removeFolder = async (folder: ProjectFolderType) => {
  if (!base.value?.id) return

  try {
    await deleteProjectFolder({
      baseId: base.value.id,
      folderId: folder.id,
    })
  } catch (e: any) {
    message.error(await extractSdkResponseErrorMsg(e))
  }
}

const createTable = (folderId?: string | null) => {
  emits('createTable', folderId)
}
</script>

<template>
  <div class="border-none sortable-list">
    <template v-if="base">
      <div
        v-if="!availableNodeCount && showCreateTableBtn"
        :class="{
          'text-nc-content-brand hover:text-nc-content-brand-disabled': openedProject?.id === baseId,
          'text-nc-content-gray-muted hover:text-nc-content-brand': openedProject?.id !== baseId,
        }"
        class="nc-create-table-btn flex flex-row items-center cursor-pointer rounded-md w-full"
        role="button"
        @click="createTable()"
      >
        <div class="nc-project-home-section-item">
          <GeneralIcon icon="plus" />
          <div>
            {{
              $t('general.createEntity', {
                entity: $t('objects.table'),
              })
            }}
          </div>
        </div>
      </div>

      <div
        v-if="!availableNodeCount || !visibleNodeCount"
        class="py-0.5 text-nc-content-gray-muted font-normal"
        :class="{
          'nc-project-home-section-item': sourceIndex === 0,
          'ml-9 xs:(ml-9.75)': sourceIndex !== 0,
        }"
      >
        {{
          availableNodeCount && !visibleNodeCount
            ? $t('placeholder.noResultsFoundForYourSearch')
            : $t('placeholder.noTables')
        }}
      </div>

      <div
        v-if="source && source.enabled"
        ref="menuRefs"
        :key="`sortable-${source?.id}-${source?.id && source?.id in keys ? keys[source?.id] : '0'}`"
        :nc-source="source?.id"
      >
        <FolderNode
          v-for="folder of filteredTableTree.folders"
          :key="folder.id"
          :base="base"
          :folder="folder"
          :folders="folder.folders"
          :tables="folder.tables"
          :source-index="sourceIndex"
          :level="0"
          @create-folder="createFolder"
          @create-table="createTable"
          @rename-folder="renameFolder"
          @delete-folder="removeFolder"
        />

        <TableNode
          v-for="table of filteredTableTree.rootTables"
          :key="table.id"
          class="nc-tree-item text-sm"
          :data-order="table.order"
          :data-id="table.id"
          :table="table"
          :base="base"
          :source-index="sourceIndex"
          :data-title="table.title"
          :data-source-id="source?.id"
          :data-type="table.type"
        >
        </TableNode>
      </div>
    </template>
  </div>
</template>
