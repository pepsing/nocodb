import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const up = async (knex: Knex) => {
  if (!(await knex.schema.hasTable(MetaTable.PROJECT_FOLDERS))) {
    await knex.schema.createTable(MetaTable.PROJECT_FOLDERS, (table) => {
      table.string('id', 20).primary().notNullable();
      table.string('fk_workspace_id', 20).notNullable();
      table.string('base_id', 20).notNullable();
      table.string('source_id', 20);
      table.string('fk_parent_id', 20);
      table.string('title', 255).notNullable();
      table.text('description');
      table.float('order');
      table.timestamps(true, true);

      table.index(['fk_workspace_id', 'base_id'], 'nc_project_folders_base_idx');
      table.index(['base_id', 'source_id'], 'nc_project_folders_source_idx');
      table.index('fk_parent_id', 'nc_project_folders_parent_idx');
    });
  }

  if (!(await knex.schema.hasColumn(MetaTable.MODELS, 'fk_folder_id'))) {
    await knex.schema.alterTable(MetaTable.MODELS, (table) => {
      table.string('fk_folder_id', 20);
      table.index('fk_folder_id', 'nc_models_v2_folder_idx');
    });
  }
};

const down = async (knex: Knex) => {
  if (await knex.schema.hasColumn(MetaTable.MODELS, 'fk_folder_id')) {
    await knex.schema.alterTable(MetaTable.MODELS, (table) => {
      table.dropIndex('fk_folder_id', 'nc_models_v2_folder_idx');
      table.dropColumn('fk_folder_id');
    });
  }

  await knex.schema.dropTableIfExists(MetaTable.PROJECT_FOLDERS);
};

export { up, down };
