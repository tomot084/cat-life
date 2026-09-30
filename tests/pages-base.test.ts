import test from 'node:test';
import assert from 'node:assert/strict';
import { pagesBase } from '../config/pagesBase';

test('Pages base derives only from explicit owner/repository and handles user sites', () => {
  const prior = process.env.GITHUB_REPOSITORY;
  try {
    process.env.GITHUB_REPOSITORY='fixture-owner/fixture-repository';
    assert.equal(pagesBase(),'/fixture-repository/');
    process.env.GITHUB_REPOSITORY='fixture-owner/fixture-owner.github.io';
    assert.equal(pagesBase(),'/');
    process.env.GITHUB_REPOSITORY='invalid';
    assert.throws(()=>pagesBase(),/Invalid/);
  } finally {
    if (prior === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY=prior;
  }
});
