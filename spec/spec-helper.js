require('source-map-support').install();

var path = require('path');

var Helpers = {
  expect : require('azk-dev/chai').expect,

  fixture_path(...fixture) {
    return path.resolve(
      '.', 'spec', 'fixtures', ...fixture
    );
  },
};

export default Helpers;
