import utils from "./utils";

// Dependencies
var R        = require("ramda");
var BPromise = require("bluebird");
var path     = require("path");
var fs       = BPromise.promisifyAll(require("fs"));
var stripJsonComments = require("strip-json-comments");

// Log
var chalk = require('chalk');

export class Asana2Pivotal {
  constructor(options) {
    options = R.merge({
      from  : 'debug.json',
      to    : 'normalized.json',
      config: 'map.json'
    }, options);

    if (options.verbose) {
      utils.verbose = options.verbose;
    }

    options.from   = path.resolve(process.cwd(), options.from);
    options.to     = path.resolve(process.cwd(), options.to);
    options.config = path.resolve(process.cwd(), options.config);

    this.map     = this.readMapFile(options.config);
    this.options = options;
  }

  readMapFile(filepath) {
    filepath = filepath || this.options.map;
    var content;

    try {
      content = stripJsonComments(fs.readFileSync(filepath).toString());
      content = JSON.parse(content);
    } catch (e) {
      throw e;
    }
    return content;
  }

  run() {
    return BPromise.coroutine(function* () {
      var workspace, json, stories;

      json = yield this.readFile();
      json = this.replaceUsers(json);

      workspace = JSON.parse(json);

      if (R.is(Object, workspace) && !R.isEmpty(workspace.tasks)) {
        var old_length = workspace.tasks.length;
        utils.log("  Normalize", chalk.green(workspace.tasks.length), "tasks");
        workspace.tasks = R.filter((task) => !R.isNil(task), workspace.tasks);
        utils.log("  Remove", chalk.green(old_length - workspace.tasks.length), "empty tasks");
        stories = workspace.tasks.map(this.taskToStorie.bind(this));
      }

      utils.log("  " + chalk.green(stories.length), chalk.blue("normalized stories"));
      var normalized_json = JSON.stringify(stories, null, 2);
      this.saveFile(normalized_json);

      return stories;
    }.bind(this))();
  }

  readFile(filepath) {
    filepath = filepath || this.options.from;
    return fs.readFileAsync(filepath)
      .then(function (data) {
        utils.log("Successful read file " + chalk.green(filepath));
        return data.toString();
      })
      .catch(BPromise.OperationalError, function (e) {
        console.error("unable to read file, because: ", e.message);
      });
  }

  saveFile(json) {
    var filepath = this.options.to;
    fs.writeFileAsync(filepath, json)
      .then(function() {
        utils.log("Successful saved file " + chalk.green(filepath));
      });
  }

  replaceUsers(json) {
    var asana_ids = Object.keys(this.map.users);

    for (var i = 0; asana_ids.length > i; i++) {
      var user_id = asana_ids[i];
      var user    = this.map.users[user_id];

      // Mention Replaces
      var url   = 'https://app.asana.com/0/' + user.mention_id + '/' + user.mention_id;
      var regex = new RegExp(url, "gm");
      json = json.replace(regex, '@' + user.username);

      // UserID replace
      regex = new RegExp(user_id, "gm");
      json  = json.replace(regex, user.pivotal_id);
    }

    return json;
  }

  projectMap(task) {
    var projectMaped = R.clone(this.map.defaults.projects);

    console.log('task:', task);
    if (!R.isEmpty(task.projects) && !R.isEmpty(task.projects[0])) {
      projectMaped = R.clone(this.map.projects[task.projects[0].id]) || projectMaped;
    }

    // Replaces the state based in section
    var membership = R.find(R.prop('section'))(task.memberships);
    var section    = (membership && membership.section.name);
    if (!R.isNil(section) && this.map.sections.hasOwnProperty(section)) {
      var sectionMaped = R.clone(this.map.sections[section]);
      if (!R.isNil(sectionMaped)) {
        if (sectionMaped.hasOwnProperty("state")) {
          projectMaped.state = sectionMaped.state;
        }
        if (sectionMaped.hasOwnProperty("labels") && R.isArrayLike(sectionMaped.labels)) {
          projectMaped.labels = projectMaped.labels.concat(sectionMaped.labels);
        }
      }
    }

    return projectMaped;
  }

  taskToStorie(task) {
    var projectMaped = this.projectMap(task);
    var comments     = this.comments(task);
    var assignee     = (task.assignee) ? [task.assignee] : [];
    var labels       = projectMaped.labels.concat(task.tags);

    var [subtasks, owners, subtasks_comments] = this.subtasksToTasks(task.subtasks);

    labels = R.map((label) => {
      if (R.is(Object, label) && label.hasOwnProperty('name')) {
        label = label.name;
      } else if (!R.is(String, label)) {
        label = null;
      }
      return label;
    }, labels);

    // array of object to array of ids
    var owner_ids = R.map((owner) => owner.id, assignee.concat(owners));

    // Clean duplicated and limit to three owners.
    owner_ids = R.slice(0, 3)(R.uniq(owner_ids));
    labels = R.uniq(labels);

    // clean nil or empty
    labels = R.filter(((label) => !R.isNil(label) && !R.isEmpty(label)), labels);

    // Clean invalid person_id in comments
    var user_keys   = Object.keys(this.map.users);
    var user_values = Object.values(this.map.users);
    var removeInvalidPerson_ids = (comment) => {
      if (comment.person_id) {
        var result = R.contains(comment.person_id)(user_keys);
        if (!result) {
          var filterPersonId = R.propEq('pivotal_id', (comment.person_id || '').toString());
          var pivotal_user   = R.find(filterPersonId)(user_values);

          if (!pivotal_user) {
            delete(comment.person_id);
          }
        }
      }
      return comment;
    };
    comments = R.map(removeInvalidPerson_ids, comments.concat(subtasks_comments));

    var story = {
      name         : task.name,
      labels       : labels,
      description  : task.notes,
      project_id   : projectMaped.pivotal_id,
      current_state: projectMaped.state,
      tasks        : subtasks,
      owner_ids    : owner_ids,
      comments     : comments
    };

    if (!R.isNil(task.due_on)) {
      story.deadline   = (new Date(task.due_on)).toISOString();
      story.story_type = "release";
    }
    if (story.current_state && story.current_state == "finished") {
      story.estimate = 1;
    }

    return story;
  }

  // Remove system comments
  cleanSystemComments(stories) {
    if (R.isArrayLike(stories)) {
      var isntSystem = function(storie) {
        return storie.type !== "system";
      };
      stories = R.filter(isntSystem, stories);
    }
    return stories;
  }

  subtasksToTasks(tasks) {
    var assignees     = [];
    var descriptions  = [];
    var normalize = function(subtask) {
      if (!R.isEmpty(subtask.notes)) {
        descriptions.push({
          text: '`[' + subtask.name + ']:`' + subtask.notes
        });
      }

      if (subtask.assignee) { assignees.push(subtask.assignee); }

      return {
        description: subtask.name,
        complete   : !!subtask.completed
      };
    };
    var subtasks = R.map(normalize, tasks);
    return [subtasks, assignees, descriptions];
  }

  comments(task) {
    var comments  = this.cleanSystemComments(task.stories);
    var normalize = function(storie) {
      return {
        text: storie.text,
        person_id: storie.created_by.id
      };
    };
    comments = R.map(normalize, (comments || []));

    // attachments
    var attachments = R.map(((attach) => {
      return {
        name: attach.name,
        url : attach.download_url
      };
    }), (task.attachments || []));
    attachments = (!R.isEmpty(attachments)) ? [{ file_attachments: attachments }] : [];

    return attachments.concat(comments);
  }
}
