# Simon Bot

The goal of this bot is to provide some basic automation around tedious things
that I need to do regularly.

## What
This bot is meant to operate as a helper for various actions on github. It runs as a service
that needs to be hosted with access to github (currently via a personal access token)

If you put a :shipit: in any comment on a PR, it will automatically merge it into master if possible,
and otherwise will rebase it up to master repeatedely until CI passes, and then merge it into master.
This is useful if your CI is failing due to transient errors or if master is broken but a fix will come
in the future and you'd very much like to forget about your PR because it'd done.

If you put a :fire_engine: in any comment on a PR, it will only keep rebasing your branch onto master
until it passes CI. This is useful if you want to show passing CI before asking for review but you're
waiting for master to get a fix for tests that aren't relevant to your PR.

## Configuration
- add your github personal access token (TODO link to how to get one) into a file called `secrets.json`