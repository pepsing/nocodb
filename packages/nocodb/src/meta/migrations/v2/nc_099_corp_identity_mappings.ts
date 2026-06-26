import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const up = async (knex: Knex) => {
  if (await knex.schema.hasTable(MetaTable.CORP_IDENTITY_MAPPINGS)) {
    return;
  }

  await knex.schema.createTable(MetaTable.CORP_IDENTITY_MAPPINGS, (table) => {
    table.string('id', 20).primary().notNullable();

    table.string('provider', 64).notNullable().defaultTo('corporate');
    table.string('subject', 255);
    table.string('employee_code', 64);
    table.string('email', 255);
    table.string('display_name', 255);
    table.string('department', 255);

    table.string('fk_user_id', 20);
    table.string('org_roles', 255);
    table.string('workspace_roles', 255);
    table.string('base_roles', 255);

    table.boolean('is_super_admin').defaultTo(false).notNullable();
    table.boolean('is_disabled').defaultTo(false).notNullable();
    table.boolean('auto_provisioned').defaultTo(false).notNullable();

    table.text('last_claims');
    table.timestamp('last_login_at');
    table.timestamps(true, true);

    table.unique(['provider', 'subject'], 'nc_corp_identity_provider_subject');
    table.index(['provider', 'employee_code'], 'nc_corp_identity_employee');
    table.index('fk_user_id', 'nc_corp_identity_user_idx');
    table.index('is_disabled', 'nc_corp_identity_disabled_idx');
  });
};

const down = async (knex: Knex) => {
  await knex.schema.dropTableIfExists(MetaTable.CORP_IDENTITY_MAPPINGS);
};

export { up, down };
