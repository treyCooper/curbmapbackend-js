var assert = require('assert');
var request = require('supertest');
describe('loading express', function () {
    var server;
    beforeEach(function () {
        server = require('./server');
    });
    afterEach(function () {
        server.close();
    });
    it('responds to /areaCircle', function testSlash(done) {
        request(server)
            .get('/areaCircle?')
            .expect(200, done);
    });
});