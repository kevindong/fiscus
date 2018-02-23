var request = require('supertest');
var server = require('../server');
var User = require('../models/User');

describe('Admin console', function () {
    const userDetails = {
        email: 'test@example.com',
        password: 'reeeeeeeeeee'
    };
    // create login user to test with
    before(function (done) {
        new User()
            .where({ email: userDetails.email })
            .destroy()
            .then(function () {
                new User({ name: 'Testerino (Admin)', email: userDetails.email, password: userDetails.password, isAdmin: true, isConfirmed: true, isBanned: false })
                    .save()
                    .then(() => done());
            });
    });
    // cleanup after tests
    after(function (done) {
        new User()
            .where({ email: userDetails.email })
            .destroy();
        done();
    });

    var agent = request.agent(server);

    describe('GET /admin as a regular user', function () {
        it('should redirect to login page', function (done) {
            agent.get('/admin')
                .expect(302)
                .expect('Location', '/login')
                .end(function (err, response) {
                    if (err) {
                        done(err);
                    } else {
                        done();
                    }
                });
        });
    });

    describe('POST /login as an admin user', function () {
        it('admins should log in', function (done) {
            agent.post('/login')
                .send(userDetails)
                .expect(302)
                .expect('Location', '/')
                .end(function (err, response) {
                    if (err) {
                        done(err);
                    } else {
                        done();
                    }
                });
        });
    });

    describe('GET /admin as an admin user', function () {
        it('should return ok', function (done) {
            agent.get('/admin')
                .expect(200)
                .end(function (err, response) {
                    if (err) {
                        done(err);
                    } else {
                        done();
                    }
                });
        });
    });
});