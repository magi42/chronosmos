"""Exercise private environment installation without SSH or real credentials."""
import importlib.util
import os
from pathlib import Path
import shlex
import subprocess
import sys


def test_key_install_preserves_session_secret_and_real_newlines(tmp_path, monkeypatch):
    script = Path(__file__).resolve().parents[1] / 'scripts/configure_openai.py'
    spec = importlib.util.spec_from_file_location('configure_openai', script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    config = tmp_path/'local.json'
    config.write_text('{"ssh_host":"test-host"}')
    local = tmp_path/'.env'
    local.write_text('OPENAI_API_KEY=sk-test-dummy-only\n')
    remote = tmp_path/'server.env'
    remote.write_text('CHRONOSMOS_SECRET_KEY=existing-session-secret\nOPENAI_API_KEY=old-key\nCHRONOSMOS_SECURE_COOKIES=1\n')
    owner = remote.stat()
    actual_run = subprocess.run
    calls = []
    def run(args, **kwargs):
        assert args[:2] == ['ssh','test-host']
        assert 'sk-test-dummy-only' not in str(args)
        calls.append(args)
        if len(calls) == 1:
            code = shlex.split(args[2])[3]
            assert "p=pathlib.Path('/etc/chronosmos/chronosmos.env')" in code
            code = code.replace("p=pathlib.Path('/etc/chronosmos/chronosmos.env')",'p=pathlib.Path('+repr(str(remote))+')')
            return actual_run([sys.executable,'-c',code],**kwargs)
        assert args[2] == 'sudo systemctl restart chronosmos && sudo systemctl is-active chronosmos'
    monkeypatch.setattr(module.subprocess,'run',run)
    monkeypatch.setattr(sys,'argv',[str(script),'--config',str(config),'--env-file',str(local)])
    module.main()
    assert remote.read_text().splitlines() == ['CHRONOSMOS_SECRET_KEY=existing-session-secret','CHRONOSMOS_SECURE_COOKIES=1','OPENAI_API_KEY=sk-test-dummy-only']
    assert remote.stat().st_mode & 0o777 == 0o640
    assert (remote.stat().st_uid,remote.stat().st_gid) == (owner.st_uid,owner.st_gid)
    assert local.stat().st_mode & 0o777 == 0o600
    assert len(calls) == 2
