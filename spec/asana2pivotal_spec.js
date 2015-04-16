import h from './spec-helper';
import { Asana2Pivotal } from '../src/asana2pivotal';

var R        = require("ramda");
var BPromise = require("bluebird");

describe("Asana2Pivotal", function() {

  var asana2pivotal;

  var options = {
    from  : h.fixture_path('dump-blog.json'),
    to    : h.fixture_path('normalized-blog.json'),
    config: h.fixture_path('map.json')
  };

  describe('should options', function () {
    it("with default paths", function() {
      asana2pivotal = new Asana2Pivotal(options);
      var result_options = asana2pivotal.options;
      h.expect(result_options).to.have.property("from", h.fixture_path('dump-blog.json'));
      h.expect(result_options).to.have.property("to", h.fixture_path('normalized-blog.json'));
    });

    it("with custom paths", function() {
      asana2pivotal = new Asana2Pivotal({
        from: h.fixture_path('dump.json'),
        to  : h.fixture_path('normalized.json'),
      });
      var result_options = asana2pivotal.options;
      h.expect(result_options).to.have.property("from", h.fixture_path('dump.json'));
      h.expect(result_options).to.have.property("to", h.fixture_path('normalized.json'));
    });
  });

  describe('tasks from file', function () {
    var json, workspace;

    beforeEach(function () {
      BPromise.coroutine(function* () {
        asana2pivotal = new Asana2Pivotal(options);
        json = yield asana2pivotal.readFile();
        json = asana2pivotal.replaceUsers(json);
        workspace = JSON.parse(json);
      })();
    });

    it('should read slim dump', function () {
      BPromise.coroutine(function* () {
        var slim_json      = yield asana2pivotal.readFile(h.fixture_path('dump-slim.json'));
        var slim_workspace = JSON.parse(slim_json);
        h.expect(slim_workspace).to.eql({
          "id": "5135822594793",
          "name": "Azuki",
        });
      })();
    });

    it('should parsed tasks', function () {
      h.expect(workspace).to.have.property("tasks");
      h.expect(workspace.tasks.length).to.eql(4);
    });

    it('should subtasks, attachments and stories from first task', function () {
      var task = workspace.tasks[0];

      h.expect(task).to.have.property("subtasks");
      h.expect(task).to.have.property("attachments");
      h.expect(task).to.have.property("stories");
      h.expect(task.subtasks.length   ).to.eql(3);
      h.expect(task.attachments.length).to.eql(1);
      h.expect(task.stories.length    ).to.eql(5);
    });

    it('should replaced users from first task', function () {
      var task = workspace.tasks[0];

      h.expect(task).to.have.property("notes", 'Teste de Menção @gullitmiranda.');
      h.expect(task).to.have.property("followers");
      var follower = task.followers[0];
      h.expect(follower).to.have.property("id", 2222222);
    });

    describe('normalize tasks to stories', function () {
      var should;
      beforeEach(function () {
        var normalizedStories = asana2pivotal.taskToStorie.bind(asana2pivotal);
        workspace.stories = R.map(normalizedStories, workspace.tasks);

        should = {
          name         : "Blog Template - Sub-tasks",
          description  : "Teste de Menção @gullitmiranda.",
          project_id   : "6451272",
          current_state: "unstarted",
          deadline     : "2015-04-10T00:00:00.000Z",
          story_type   : "release"
        };
      });

      it('should main elements from first storie', function () {
        var storie = workspace.stories[0];

        h.expect(storie.name         ).to.deep.equal(should.name         );
        h.expect(storie.description  ).to.deep.equal(should.description  );
        h.expect(storie.project_id   ).to.deep.equal(should.project_id   );
        h.expect(storie.current_state).to.deep.equal(should.current_state);
        h.expect(storie.deadline     ).to.deep.equal(should.deadline     );
        h.expect(storie.story_type   ).to.deep.equal(should.story_type   );
      });

      it('should no have deadline and story_type from first storie', function () {
        var storie = workspace.stories[1];

        h.expect(storie).to.not.have.property("deadline");
        h.expect(storie).to.not.have.property("story_type");
      });

      it('should labels from first storie', function () {
        var storie = workspace.stories[0];
        var labels = ["blog", "test", "2tag"];

        h.expect(storie.labels).to.deep.equal(labels);
      });

      it('should tasks from first storie', function () {
        var storie = workspace.stories[0];
        var tasks = [
          { complete: false, description: "Draft post", },
          { complete: true , description: "Review/final edits" },
          {
            complete: false,
            description: "modificar insight para permitir verificação de erros caso necessário"
          }
        ];

        h.expect(storie.tasks).to.deep.equal(tasks);
      });

      it('should owners from first storie', function () {
        var storie = workspace.stories[0];
        var owner_ids = [ 6598261, 3333333 ];
        // Gullit Miranda
        // Julio Saito

        h.expect(storie.owner_ids).to.deep.equal(owner_ids);
      });

      it('should comments from first storie', function () {
        var storie = workspace.stories[0];
        var comments = [{
          file_attachments: [
            ['https://s3.amazonaws.com:443/prod_object_assets/assets/',
            '31435545906893/softwareengineer_7701382-655x280.jpg',
            '?AWSAccessKeyId=AKIAI7NUHQYARXR2GGCQ&Expires=1428805953',
            '&Signature=GJCt9bJQkEwb4UKmpyFQpidzngM%3D#_=_'].join('')
          ]
        }, {
          person_id: 2926078,
          text: ['O @heitor e o @julio testaram o https://atom.io/packages/motepair, ',
                'que pode ser uma ferramente bem funcional e interessante.'].join('')
        }, {
          person_id: 3333333,
          text: ['sim, é bem legal. só que só funciona no atom. O atom por sua vez me ',
                'parece cada dia mais utilizável.'].join('')
        }, {
          person_id: 5555555,
          text: ['Me intrometendo aí: ouvi falar muito bem desse plugin de Sublime.\n',
                'http://teamremote.github.io/remote-sublime/'].join('')
        }, {
          person_id: 3333333,
          text: 'vamos testar!'
        }, {
          text: ['Resumo das características de `rsync` e `unison` https://bitbucket.org/azukiapp/',
                'azk-internal-book/src/master/projetos/azk/file_sharing_sync_options.md'].join('')
        }, {
          text: "`[Draft post]:`with notes"
        }];

        h.expect(storie.comments).to.deep.equal(comments);
      });
    });
  });
});
