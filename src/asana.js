import utils from "./utils";

// Dependencies
var R        = require('ramda');
var BPromise = require("bluebird");
var path     = require("path");
var fs       = BPromise.promisifyAll(require("fs"));
var Client   = require("asana").Client;

// Log
var chalk = require('chalk');

export class Asana {
  constructor(api_key, options) {
    options = R.merge({
      to: 'debug.json'
    }, options);
    options.to   = path.resolve(process.cwd(), options.to);

    if (options.verbose) {
      utils.verbose = options.verbose;
    }

    this.client  = Client.create().useBasicAuth(api_key);
    this.options = options;
  }

  run(workspace_name, projects) {
    utils.log("Get tasks from projects", chalk.green(projects.join(chalk.white(', '))));
    return BPromise.coroutine(function* () {
      var workspace = yield this._workspaceByName(workspace_name);
      workspace.projects = yield this._projectsByWorkspace(workspace, projects);
      workspace.tasks    = yield this._tasksAllProjects(projects, workspace);

      var json = JSON.stringify(workspace, null, 2);
      this.saveFile(json);
      return workspace;
    }.bind(this))();
  }

  saveFile(json) {
    var filename = this.options.to;
    fs.writeFileAsync(filename, json)
      .then(function() {
        utils.log("Successful saved file " + chalk.green(filename));
      });
  }

  _taskById(task) {
    utils.log("      Find task by id", chalk.green(task.id), "-", task.name);

    return BPromise.coroutine(function* () {
      task = yield this.client.tasks.findById(task.id);
      var attachments = yield this._attachmentsByTaskId(task.id);
      var stories     = yield this._storiesByTaskId(task.id);
      var subtasks    = yield this._subtasksByTaskID(task.id);

      task.attachments = attachments;
      task.stories     = this._storiesClean(stories);
      task.subtasks    = subtasks;

      return task;
    }.bind(this))();
  }

  _tasksByProject(project) {
    utils.log("    Find tasks in", chalk.green(project.id), project.name);
    return BPromise.coroutine(function* () {
      var tasks = yield this.client.tasks
        .findByProject(project.id)
        .then((result) => result.data ? result.data : []);

      for (var ix = 0; ix < tasks.length; ix++) {
        tasks[ix] = yield this._taskById(tasks[ix]);
      }

      return tasks;
    }.bind(this))();
  }

  _tasksAllProjects(projects, workspace) {
    return BPromise.coroutine(function* () {
      var all_tasks = [];
      for (var i = 0; projects.length > i; i++) {
        var filter    = R.find(R.propEq('name', projects[i]));
        var project   = filter(workspace.projects);

        if (!R.isEmpty(project) && project.id) {
          var tasks = yield this._tasksByProject(project);

          all_tasks = all_tasks.concat(tasks);
        }
      }
      return all_tasks;
    }.bind(this))();
  }

  _attachmentsByTaskId(id) {
    utils.log("        Find attachments by task id", chalk.green(id));
    return BPromise.coroutine(function* () {
      var attachments = yield this.client.attachments.findByTask(id)
        .then((result) => result.data ? result.data : []);

      for (var ix = 0; ix < attachments.length; ix++) {
        attachments[ix] = yield this._attachmentById(attachments[ix]);
      }

      return attachments;
    }.bind(this))();
  }

  _attachmentById(attachment) {
    utils.log("          Find attachment", chalk.green(attachment.id), '-', attachment.name);
    return this.client.attachments.findById(attachment.id);
  }

  _subtasksByTaskID(id) {
    utils.log("        Find subtasks from task", chalk.green(id));
    return BPromise.coroutine(function* () {
      var subtasks = yield this.client.tasks
        .subtasks(id)
        .then((result) => result.data ? result.data : []);

      for (var i = 0; subtasks.length > i; i++) {
        subtasks[i] = yield this._taskById(subtasks[i]);
      }

      return subtasks;
    }.bind(this))();
  }

  _storiesByTaskId(id) {
    utils.log("        Find stories by task id", chalk.green(id));
    return this.client.stories
      .findByTask(id)
      .then((result) => result.data ? result.data : []);
  }

  // Remove system stories
  _storiesClean(stories) {
    if (R.isArrayLike(stories)) {
      var isntSystem = function(storie) {
        return storie.type !== "system";
      };
      stories = R.filter(isntSystem, stories);
    }
    return stories;
  }

  _projectsByWorkspace(workspace, projects) {
    utils.log("  Find projects in", chalk.green(workspace.id), '-', workspace.name);
    return BPromise.coroutine(function* () {
      var all_projects = yield this.client.projects
        .findAll({ workspace: workspace.id })
        .then((result) => result.data ? result.data : []);

      var inProjects = (project) => R.contains(project.name)(projects);
      var filtered_projects = R.filter(inProjects, all_projects);

      return filtered_projects;
    }.bind(this))();
  }

  _workspaceByName(workspace) {
    utils.log("Find workspace", chalk.green(workspace));
    return this.client.users.me()
      .then(function(user) {
        var filter = R.find(R.propEq('name', workspace));
        return filter(user.workspaces);
      });
  }
}
