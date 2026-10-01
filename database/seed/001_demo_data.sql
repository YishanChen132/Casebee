INSERT INTO rag_examples (id, title, platform, project_item, quote_amount, outcome, summary, reply_example, case_type, project_aliases, typical_missing_fields, quote_range_min, quote_range_max, success_pattern)
VALUES
  ('rag-logo-namecard-001', 'Logo + 名片設計', 'LINE', 'Logo + 名片設計', 15000, '成交並準時交付', '新客戶詢問 Logo 與名片設計，需求明確但預算需引導。最後以 15000 成交，包含 2 次修改。', '您好，Logo + 名片設計會依照品牌風格與修改輪數調整，初步範圍約 12000-18000。若方便，我可以先了解品牌產業與喜歡的視覺方向。', 'quote_inquiry', '["Logo", "品牌識別", "名片"]'::jsonb, '["quote_amount", "expected_deadline", "reference"]'::jsonb, 12000, 18000, '先確認品牌方向、交付項目與修改次數。'),
  ('rag-reels-urgent-001', 'Reels 影片急件', 'Gmail', 'Reels 影片', 10000, '急件加價成交', '客戶需要短影音急件，原預算偏低，最後以急件費調整到 10000 並確認交付範圍。', '您好，明天前提供初版可以協助，但因時程較急，建議先確認腳本、素材與修改次數。若以急件處理，報價會落在 10000 左右。', 'collaboration_invite', '["Reels", "短影音", "宣傳影片", "IG 限動", "Instagram Reels"]'::jsonb, '["quote_amount", "usage_rights", "revision_scope", "deliverables"]'::jsonb, 10000, 30000, '確認授權範圍、審稿流程、露出平台與急件費。'),
  ('rag-website-redesign-001', '網站重新設計', 'Gmail', '網站重新設計', 98000, '簽約後進入製作', '企業客戶確認網站改版合作，後續以合約與首付款推進，適合正式書面回覆。', '太好了，感謝確認。我可以先整理合約、付款節點與專案時程，若方便的話我們可以約明天下午確認簽約流程。', 'confirmation_or_contract', '["網站", "官網", "網頁", "landing page"]'::jsonb, '["scope", "quote_amount", "expected_deadline", "contract"]'::jsonb, 80000, 150000, '確認頁數、功能、合約、付款節點。'),
  ('rag-ig-post-scope-001', 'IG 貼文追加需求', 'LINE', 'IG 貼文設計', 8500, '追加張數後調整報價', '客戶從 3 張貼文追加到 5 張，系統提醒 scope creep，最後追加報價並延長交期。', '可以協助調整為 5 張。因為張數增加，建議同步調整報價與交期，我可以先幫您整理新版範圍與時程確認。', 'revision_request', '["IG 貼文", "社群貼文", "Instagram", "貼文"]'::jsonb, '["scope", "quote_amount", "expected_deadline"]'::jsonb, 6000, 15000, '追加範圍需同步調整報價與交期。'),
  ('rag-brand-collab-001', '品牌合作初談', 'Manual', '品牌合作', null, '待釐清後轉為提案', '客戶只表達想聊合作但沒有預算、交期與交付物，最佳回覆是先釐清合作形式。', '謝謝您喜歡我的作品。若方便的話，想先了解這次合作形式、預計產出、時程與預算範圍，我就能更快整理合適提案。', 'collaboration_invite', '["品牌合作", "合作邀請", "宣傳合作"]'::jsonb, '["project_item", "quote_amount", "expected_deadline", "deliverables", "usage_rights"]'::jsonb, null, null, '先釐清合作形式、產出、預算、時程與授權。'),
  ('rag-product-photo-risk-001', '產品攝影素材延後', 'LINE', '產品攝影', 28000, '更新排程避免逾期', '產品攝影案因客戶素材延後導致交期風險，需先更新時程並確認是否影響交付日。', '了解，為避免影響交期，我想先確認素材預計哪一天可以提供。收到素材後我會重新安排拍攝與修圖時程。', 'deadline_or_material_risk', '["產品攝影", "拍攝", "修圖", "素材"]'::jsonb, '["expected_deadline", "required_materials", "revision_scope"]'::jsonb, 20000, 40000, '素材延遲時先重排時程並確認是否影響交付。')
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  platform = EXCLUDED.platform,
  project_item = EXCLUDED.project_item,
  quote_amount = EXCLUDED.quote_amount,
  outcome = EXCLUDED.outcome,
  summary = EXCLUDED.summary,
  reply_example = EXCLUDED.reply_example,
  case_type = EXCLUDED.case_type,
  project_aliases = EXCLUDED.project_aliases,
  typical_missing_fields = EXCLUDED.typical_missing_fields,
  quote_range_min = EXCLUDED.quote_range_min,
  quote_range_max = EXCLUDED.quote_range_max,
  success_pattern = EXCLUDED.success_pattern;
