# Phase 36 — Segregation Enforcement

Configured segregation-of-duties policies are now enforced during user creation, the dedicated access-change flow and the general user-update flow. The server calculates the complete proposed permission set from the role template plus overrides and returns `409` when both sides of an active conflict are present.

No default conflict rules are inserted automatically because Voxel Veda must review its real finance and HR responsibilities first. Enabling an unreviewed rule could lock out legitimate operations. Policy creation remains step-up protected and audited through the Continuous Assurance API.
