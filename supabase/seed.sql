-- Local development only. Hosted migrations create a NOLOGIN role; hosted credentials are provisioned separately.
ALTER ROLE mekoniq_app LOGIN PASSWORD 'local_test_only';
