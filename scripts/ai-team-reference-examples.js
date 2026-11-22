'use strict';

const { createHash } = require('node:crypto');

// Reviewed public examples from the attached ECC snapshot at upstream commit
// 4adeee6732a12d1540f49a4d50a38ce8c97f9a53 and its generated Codex adapter.
// Pin the complete original bytes, relative path, line and finding kind. Any
// edit invalidates that file's exceptions; adding new reference files grants
// nothing. This does not allow high-confidence credential signatures, nor make
// these documented sample values suitable for application configuration.
const reviewed = Object.freeze({
  '.codex/agents/ecc-opensource-forker.toml': Object.freeze({
    sha256: 'fd8ce80395cf84f60398789a4b4818fb9df149787e5835c3b46aeb84e8150a7b',
    findings: Object.freeze({ 138: 'hardcoded-database_url', 143: 'hardcoded-jwt_secret' })
  }),
  '.ai-team/ecc-reference/agents/opensource-forker.md': Object.freeze({
    sha256: '3cbe7f04a15fe67355ded13103e3b961c51678ba93c2db1b25b4f88aa0a3dee6',
    findings: Object.freeze({ 135: 'hardcoded-database_url', 140: 'hardcoded-jwt_secret' })
  }),
  '.ai-team/ecc-reference/skills/deployment-patterns/SKILL.md': Object.freeze({
    sha256: 'b864abd1954570c4a469b7e1deb897e57858d25db2fd98d035ff7bca4a15b9b6',
    findings: Object.freeze({ 338: 'hardcoded-database_url' })
  }),
  '.ai-team/ecc-reference/skills/django-security/SKILL.md': Object.freeze({
    sha256: '9bee68f0fd5ae193693745c1fdc99b6335d30f9b113aebe171fe3d675cf5ad8e',
    findings: Object.freeze({ 581: 'hardcoded-database_url', 587: 'hardcoded-database_url' })
  }),
  '.ai-team/ecc-reference/skills/docker-patterns/SKILL.md': Object.freeze({
    sha256: 'c0cedeb9b64d4468f5af3bb0a97659c654f0ceb916acbec867a29dc682dd633f',
    findings: Object.freeze({ 27: 'hardcoded-database_url' })
  }),
  '.ai-team/ecc-reference/skills/flox-environments/SKILL.md': Object.freeze({
    sha256: 'ab73da7c17ec6a003db7527676dbf20088c9836461952953b449f4e4b409a320',
    findings: Object.freeze({ 61: 'hardcoded-database_url', 374: 'hardcoded-database_url' })
  }),
  '.ai-team/ecc-reference/skills/laravel-security/SKILL.md': Object.freeze({
    sha256: '1300ff41c52cef3f868f651427aa331971c48a53fe1492e0024d0ae0468d3198',
    findings: Object.freeze({ 837: 'hardcoded-db_password' })
  }),
  '.ai-team/ecc-reference/skills/prisma-patterns/SKILL.md': Object.freeze({
    sha256: 'fb0c7644f32b22ee030071c71fa00bda1825f955f7304a375ef299a7290227f2',
    findings: Object.freeze({ 238: 'hardcoded-database_url', 241: 'hardcoded-database_url' })
  })
});

function isReviewedAiTeamReferenceExample(file, source, line, kind) {
  if (typeof file !== 'string' || !Object.hasOwn(reviewed, file) || !Buffer.isBuffer(source) ||
      !Number.isSafeInteger(line) || line < 1) return false;
  const entry = reviewed[file];
  if (!Object.hasOwn(entry.findings, line) || entry.findings[line] !== kind) return false;
  return createHash('sha256').update(source).digest('hex') === entry.sha256;
}

module.exports = { isReviewedAiTeamReferenceExample };
