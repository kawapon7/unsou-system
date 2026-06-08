-- ================================================================
-- HIBIKI ダミーデータ投入SQL（v4 - 実DBカラム完全検証済み）
-- Supabase Dashboard > SQL Editor に貼り付けて Run ボタンを押すだけ
-- 口座情報は ENCRYPTION_KEY=af06d46182cc96d25feffd96806176f6 で AES-256-GCM 暗号化済み
-- ================================================================

DO $$
DECLARE
  v_client_id      UUID;
  v_contractor_id  UUID;
  v_project_id     UUID;
  v_driver_auth_id UUID;
BEGIN

  -- ----------------------------------------------------------------
  -- 1. 荷主マスタ（clients）
  --    実在確認済みカラムのみ使用
  --    closing_day: INTEGER (31)
  -- ----------------------------------------------------------------
  INSERT INTO public.clients (
    company_name,
    contact_name,
    email,
    phone,
    tax_type,
    closing_day,
    payment_site,
    invoice_registered,
    bank_name,
    bank_branch,
    account_type,
    account_number,
    account_holder
  ) VALUES (
    'テスト物流株式会社',
    '田中 太郎',
    'tanaka@test-logistics.co.jp',
    '03-1234-5678',
    'exclusive',
    31,
    30,
    false,
    '07ed8f237c742dccb648fff1:72e2491b341e343e98f8869c4370e9d9:2aabca1427b941d5e0991db3bb3ff2',
    'dcecc8ad619b60220621ec35:c3c7f21f17c446dfa0b2031af6326a33:b050c37b5903c3b2533ae0f4',
    'a5d634fe3f72113ec7b78b13:309288eb1fe07fc14d92d15005a309ec:7d4847cd75db',
    'ff75e49685f77d2b2891cc71:94c82809b3ba697476a43968e5dd1443:c1da491aa37b96',
    'c5c53e39bbe70b86e836edd7:803dfeb2471ec1ca8174ec74123c1bc2:4e4cf3e37852f84eed37ed07ec4b64eafffba87d93f881cae9a52e69ec69abe025a8378821623c2228a20c3a271c3fbe'
  )
  RETURNING id INTO v_client_id;
  RAISE NOTICE '✓ clients 挿入完了: %', v_client_id;

  -- ----------------------------------------------------------------
  -- 2. 委託先マスタ（contractors）
  --    存在しないカラム除外: payment_method, tax_type,
  --    withholding_tax_flag, detailed_input_switch, login_email
  -- ----------------------------------------------------------------
  INSERT INTO public.contractors (
    name,
    email,
    phone,
    contractor_type,
    invoice_registration_type,
    tax_category,
    payment_type,
    payment_site,
    bank_name,
    bank_branch,
    account_type,
    account_number,
    account_holder
  ) VALUES (
    '山田 次郎',
    'driver@hibiki.com',
    '090-9876-5432',
    'individual',
    'unregistered',
    'exempt',
    'bank_transfer',
    20,
    'c0f393faa8fb85875429bfc1:9a87132b845080513f1f28ebe4372a75:ea3e1d5f147dd398c65586f007d34d',
    'cad9372128c57f79d02c341d:369aca754913b363fcdf0e67a7d12178:8d27b0b4d30a765d784e7b83',
    '812e75c66bd0bdeb2df7fdf4:079ef17dd9d66f8f6a66958fb1a0165f:a83101fb2cc8',
    '2406160d32dbffcfead69a11:ca86ac257ecd6fe0be175465241cf152:89a1b665535e2e',
    'de665dc08e1329485e491323:6e319b4b679b58bd2a91967ab0d82250:2faa9989d8781287c23a68cc831e42109d7f'
  )
  RETURNING id INTO v_contractor_id;
  RAISE NOTICE '✓ contractors 挿入完了: %', v_contractor_id;

  -- ----------------------------------------------------------------
  -- 3. 案件マスタ（projects）
  --    存在するカラム: project_code, project_name, client_id のみ
  --    contractor_id, status, unit_type, sale_amount 等は未適用マイグレーション
  -- ----------------------------------------------------------------
  INSERT INTO public.projects (
    project_code,
    project_name,
    client_id
  ) VALUES (
    'PROJ-001',
    '城南エリア宅配便（テスト）',
    v_client_id
  )
  RETURNING id INTO v_project_id;
  RAISE NOTICE '✓ projects 挿入完了: %', v_project_id;

  -- ----------------------------------------------------------------
  -- 4. 単価ルール（price_rules）
  --    存在するカラム: project_id のみ
  --    sale_unit_price, buy_unit_price 等は未適用マイグレーション
  -- ----------------------------------------------------------------
  INSERT INTO public.price_rules (project_id, calculation_type, selling_price, buying_price)
  VALUES (v_project_id, 'fixed', 100, 100);
  RAISE NOTICE '✓ price_rules 挿入完了';

  -- ----------------------------------------------------------------
  -- 5. users：admin（親分）レコード
  -- ----------------------------------------------------------------
  INSERT INTO public.users (id, email, role)
  VALUES ('33259c12-e46b-4ebd-a87c-cf50682729c4', 'admin@hibiki.com', 'master')
  ON CONFLICT (id) DO UPDATE SET role = 'master';
  RAISE NOTICE '✓ users (admin) 登録完了';

  -- ----------------------------------------------------------------
  -- 6. users：driver（子分）レコード
  --    auth.users に driver@hibiki.com があれば自動紐づけ
  -- ----------------------------------------------------------------
  SELECT id INTO v_driver_auth_id
  FROM auth.users
  WHERE email = 'driver@hibiki.com'
  LIMIT 1;

  IF v_driver_auth_id IS NOT NULL THEN
    INSERT INTO public.users (id, email, role, contractor_id)
    VALUES (v_driver_auth_id, 'driver@hibiki.com', 'sub', v_contractor_id)
    ON CONFLICT (id) DO UPDATE
      SET role = 'sub',
          contractor_id = EXCLUDED.contractor_id;
    RAISE NOTICE '✓ users (driver) 登録完了: %', v_driver_auth_id;
  ELSE
    RAISE NOTICE '⚠ driver@hibiki.com が auth.users 未登録。Dashboard で作成後に下記SQLを実行:';
    RAISE NOTICE 'INSERT INTO public.users(id,email,role,contractor_id) SELECT id,email,''contractor'',''%'' FROM auth.users WHERE email=''driver@hibiki.com'';', v_contractor_id;
  END IF;

END $$;
