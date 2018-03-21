exports.up = function(knex, Promise) {
  return Promise.all([
    knex.schema.createTable('currentSecurities', function(table) {
      table.increments().primary().notNullable();
      table.integer('portfolioId').references('portfolios.id').notNullable();
      table.string('ticker', 8).notNullable();
      table.decimal('numShares', 12, 4).notNullable();
      table.decimal('costBasis', 10, 2).notNullable();
      table.timestamps();
    })
  ]);
};

exports.down = function(knex, Promise) {
  return Promise.all([
    knex.schema.dropTable('currentSecurities')
  ])
};
