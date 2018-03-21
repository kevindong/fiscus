exports.up = function(knex, Promise) {
  return Promise.all([
    knex.schema.createTable('portfolios', function(table) {
      table.increments().primary().notNullable();
      table.integer('userId').references('users.id').notNullable();
      table.json('value');
      table.timestamps();
    })
  ]);
};

exports.down = function(knex, Promise) {
  return Promise.all([
    knex.schema.dropTable('portfolios')
  ])
};
