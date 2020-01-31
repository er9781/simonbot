# Simon Bot

The goal of this bot is to provide some basic automation around tedious things
that I need to do regularly.

## What
This bot is meant to operate as a helper for various actions on github. It runs as a service
that needs to be hosted with access to github (currently via a personal access token)

If you put a :sheep: in any comment on a PR, it will automatically merge it into master if possible,
and otherwise will rebase it up to master repeatedely until CI passes, and then merge it into master.
This is useful if your CI is failing due to transient errors or if master is broken but a fix will come
in the future and you'd very much like to forget about your PR because it'd done.

If you put a :fire_engine: in any comment on a PR, it will only keep rebasing your branch onto master
until it passes CI. This is useful if you want to show passing CI before asking for review but you're
waiting for master to get a fix for tests that aren't relevant to your PR. If it has buildkite access,
it will try to apply diff patches to your pr as needed for generated code you forgot to commit.

## Configuration
- add your github personal access token ([get one here](https://help.github.com/en/articles/creating-a-personal-access-token-for-the-command-line)) into a file called `secrets.json`
- optionally add a buildkite access token to enable the buildkite features ([get one here](https://buildkite.com/docs/apis/rest-api#authentication))
- you'll need a copy of the repository you're tring to operate on colocated on the machine you run this service on. You need to add to secrets.json the location of the cloned repository.
- you need to configure the target github repo through `repo` and `repowner` in `secrets.json` as well. (this could potentially be read from the remotes info from git, but that's a todo for later)

## Deployment
I deploy my bot to a small box and just use `systemd` to manage it. I've included a `simonbot.service.example` file for 
my config file but it'll probably take some mucking around to get it running. Sorry.
