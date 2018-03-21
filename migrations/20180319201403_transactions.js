exports.up = function(knex, Promise) {
  return Promise.all([
    knex.schema.createTable('transactions', function(table) {
      table.increments().primary().notNullable();
      table.integer('userId').references('users.id').notNullable();
      table.integer('portfolioId').references('portfolios.id').notNullable();
      table.string('ticker', 8).notNullable();
      table.decimal('value', 10, 2).notNullable();
      table.decimal('numShares', 12, 4).notNullable();
      table.string('type', 20).notNullable();
      table.date('dateTransacted').notNullable();
      table.timestamps();
    })
  ]);
};

exports.down = function(knex, Promise) {
  return Promise.all([
    knex.schema.dropTable('transactions')
  ])
};
