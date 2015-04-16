var BPromise  = require('bluebird');
var PivotalJs = require('pivotaljs');

class PivotalTracker extends PivotalJs {
  getStories(projectId, callback) {
    this.api('get', 'projects/' + projectId + '/stories', {}, callback);
  }

  deleteStory(projectId, storyId, callback) {
    this.api('delete', 'projects/' + projectId + '/stories/' + storyId, {}, callback);
  }
}

export class Pivotal {
  constructor(api_key) {
    this.client = BPromise.promisifyAll(new PivotalTracker(api_key));
  }
}
