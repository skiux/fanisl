admin@ip-172-31-14-228:/opt/fanisl/backend$ sudo -u fanisl vi .env
admin@ip-172-31-14-228:/opt/fanisl/backend$ sudo -u fanisl bash -c 'cd
/opt/fanisl/backend && PYTHONPATH=src .venv/bin/python -c "import analyzer.main
as m; print([j[0] for j in m.\_jobs]); m.trading_pool.close(); m.pool.close()"'
error connecting in 'pool-1': connection failed: connection to server at
"127.0.0.1", port 5432 failed: fe_sendauth: no password supplied error
connecting in 'pool-1': connection failed: connection to server at "127.0.0.1",
port 5432 failed: fe_sendauth: no password supplied error connecting in
'pool-1': connection failed: connection to server at "127.0.0.1", port 5432
failed: fe_sendauth: no password supplied error connecting in 'pool-1':
connection failed: connection to server at "127.0.0.1", port 5432 failed:
fe_sendauth: no password supplied error connecting in 'pool-1': connection
failed: connection to server at "127.0.0.1", port 5432 failed: fe_sendauth: no
password supplied error connecting in 'pool-1': connection failed: connection to
server at "127.0.0.1", port 5432 failed: fe_sendauth: no password supplied error
connecting in 'pool-1': connection failed: connection to server at "127.0.0.1",
port 5432 failed: fe_sendauth: no password supplied error connecting in
'pool-1': connection failed: connection to server at "127.0.0.1", port 5432
failed: fe_sendauth: no password supplied error connecting in 'pool-1':
connection failed: connection to server at "127.0.0.1", port 5432 failed:
fe_sendauth: no password supplied error connecting in 'pool-1': connection
failed: connection to server at "127.0.0.1", port 5432 failed: fe_sendauth: no
password supplied ^CTraceback (most recent call last): File "<string>", line 1,
in <module> import analyzer.main as m; print([j[0] for j in m.\_jobs]);
m.trading_pool.close(); m.pool.close() ^^^^^^^^^^^^^^^^^^^^^^^^^ File
"/opt/fanisl/backend/src/analyzer/main.py", line 31, in <module> storage =
Storage(pool) File "/opt/fanisl/backend/src/analyzer/storage.py", line 35, in
**init** self.init_db() ~~~~~~~~~~~~^^ File
"/opt/fanisl/backend/src/analyzer/storage.py", line 38, in init_db with
self.pool.connection() as conn: ~~~~~~~~~~~~~~~~~~~~^^ File
"/usr/lib/python3.13/contextlib.py", line 141, in **enter** return
next(self.gen) File
"/opt/fanisl/backend/.venv/lib/python3.13/site-packages/psycopg_pool/pool.py",
line 184, in connection conn = self.getconn(timeout=timeout) File
"/opt/fanisl/backend/.venv/lib/python3.13/site-packages/psycopg_pool/pool.py",
line 214, in getconn return self.\_getconn_with_check_loop(deadline)

```^^^^^^^^^^ File
"/opt/fanisl/backend/.venv/lib/python3.13/site-packages/psycopg_pool/pool.py",
line 226, in \_getconn_with_check_loop conn =
self.\_getconn_unchecked(deadline - monotonic()) File
"/opt/fanisl/backend/.venv/lib/python3.13/site-packages/psycopg_pool/pool.py",
line 266, in \_getconn_unchecked conn = pos.wait(timeout=timeout) File
"/opt/fanisl/backend/.venv/lib/python3.13/site-packages/psycopg_pool/pool.py",
line 880, in wait if not self.\_cond.wait(timeout): ~~~~~~~~~~~~~~~^^^^^^^^^
File "/usr/lib/python3.13/threading.py", line 363, in wait gotit =
waiter.acquire(True, timeout) KeyboardInterrupt couldn't stop thread
'pool-1-worker-0' within 5.0 seconds hint: you can try to call 'close()'
explicitly or to use the pool as context manager ^C
admin@ip-172-31-14-228:/opt/fanisl/backend$ sudo -u fanisl bash
fanisl@ip-172-31-14-228:~/backend$ grep -R "PG_CONNINFO" src .env\* 2>/dev/null
.env:PG_CONNINFO=dbname=fanisl user=fanisl host=127.0.0.1
fanisl@ip-172-31-14-228:~/backend$ env | grep PG
fanisl@ip-172-31-14-228:~/backend$ sudo -u fanisl psql fanisl fanisl is not in
the sudoers file. This incident has been reported to the administrator.
fanisl@ip-172-31-14-228:~/backend$ exit exit
admin@ip-172-31-14-228:/opt/fanisl/backend$ sudo -u fanisl psql fanisl psql
(17.10 (Debian 17.10-0+deb13u1)) Type "help" for help.

fanisl=> exit admin@ip-172-31-14-228:/opt/fanisl/backend$ sudo -u fanisl bash -c
' cd /opt/fanisl/backend && grep PG_CONNINFO .env ' PG_CONNINFO=dbname=fanisl
user=fanisl host=127.0.0.1 admin@ip-172-31-14-228:/opt/fanisl/backend$
```
