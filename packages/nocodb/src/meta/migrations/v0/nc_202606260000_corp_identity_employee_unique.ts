import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const INDEX_NAME = 'nc_corp_identity_employee';

const up = async (knex: Knex) => {
  if (!(await knex.schema.hasTable(MetaTable.CORP_IDENTITY_MAPPINGS))) {
    return;
  }

  await knex.schema
    .alterTable(MetaTable.CORP_IDENTITY_MAPPINGS, (table) => {
      table.dropIndex(['provider', 'employee_code'], INDEX_NAME);
    })
    .catch(() => undefined);

  await knex.schema.alterTable(MetaTable.CORP_IDENTITY_MAPPINGS, (table) => {
    table.unique(['provider', 'employee_code'], INDEX_NAME);
  });
};

const down = async (knex: Knex) => {
  if (!(await knex.schema.hasTable(MetaTable.CORP_IDENTITY_MAPPINGS))) {
    return;
  }

  await knex.schema
    .alterTable(MetaTable.CORP_IDENTITY_MAPPINGS, (table) => {
      table.dropUnique(['provider', 'employee_code'], INDEX_NAME);
    })
    .catch(() => undefined);

  await knex.schema
    .alterTable(MetaTable.CORP_IDENTITY_MAPPINGS, (table) => {
      table.index(['provider', 'employee_code'], INDEX_NAME);
    })
    .catch(() => undefined);
};

export { up, down };
