import test from 'node:test';
import assert from 'node:assert/strict';
import { isVolumeName, volumeStem, isImageName } from '../scan';

test('leading numbers are volumes', () => {
  assert.equal(isVolumeName('001'), true);
  assert.equal(isVolumeName('12 - Title'), true);
  assert.equal(isVolumeName('3_Title'), true);
  assert.equal(isVolumeName('1234'), true);
});

test('vol/book/chapter markers are volumes', () => {
  assert.equal(isVolumeName('Vol 3'), true);
  assert.equal(isVolumeName('Volume 12'), true);
  assert.equal(isVolumeName('Book 2'), true);
  assert.equal(isVolumeName('Chapter 5'), true);
  assert.equal(isVolumeName('ch 7'), true);
  assert.equal(isVolumeName('My Series vol. 4'), true);
});

test('trailing numbers are volumes unless they look like years', () => {
  assert.equal(isVolumeName('Detective Conan 96'), true);
  assert.equal(isVolumeName('Series 1899'), true);
  assert.equal(isVolumeName('Series 2100'), true);
  assert.equal(isVolumeName('Series 2001'), false);
  assert.equal(isVolumeName('Series 1999'), false);
});

test('plain names are not volumes', () => {
  assert.equal(isVolumeName('Detective Conan'), false);
  assert.equal(isVolumeName('extras'), false);
  assert.equal(isVolumeName(''), false);
});

test('volumeStem strips numbering to group a series', () => {
  assert.equal(volumeStem('Detective Conan 96'), 'detective conan');
  assert.equal(volumeStem('Detective Conan Vol 96'), 'detective conan');
  assert.equal(volumeStem('001'), '');
  assert.equal(volumeStem('My-Series Ch 007'), 'my series');
});

test('isImageName accepts manga pages only', () => {
  assert.equal(isImageName('page0001.jpeg'), true);
  assert.equal(isImageName('COVER.JPG'), true);
  assert.equal(isImageName('a.png'), true);
  assert.equal(isImageName('a.webp'), true);
  assert.equal(isImageName('a.html'), false);
  assert.equal(isImageName('a.json'), false);
  assert.equal(isImageName('a.zip'), false);
});
