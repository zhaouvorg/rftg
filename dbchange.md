# rftgserver database migration report

## Background

The original `rftgserver` used MySQL through `mysqlclient`. This made
`--enable-server` depend on MySQL headers, MySQL client libraries, and an
external MySQL server/database setup.

This change migrates the `rftgserver` build target to SQLite so the server can
store its data in a local database file.

## Scope

Changed:

- `src/server.c`
- `src/configure.ac`
- `src/Makefile.am`
- generated autotools files, including `src/configure`, `src/Makefile.in`,
  `src/config.h.in`, and related helper files
- `sql/server-schema.sql`

Not changed:

- `src/replay.c` still contains MySQL code. It is not part of the current
  `rftgserver` target in `src/Makefile.am`.

## Server code changes

`src/server.c` no longer includes `<mysql/mysql.h>`. It now includes
`<sqlite3.h>` and uses a shared `sqlite3 *` connection protected by a database
mutex.

The old MySQL string-building queries were replaced with SQLite prepared
statements and bind calls. This matters because several fields are binary data:

- `seed.pool`
- `choices.log`

Those fields are now stored and loaded with `sqlite3_bind_blob()` and
`sqlite3_column_blob()` instead of SQL string escaping.

The server now creates missing SQLite tables automatically on startup, so an
empty database file is enough.

## Password behavior

The old MySQL code used `SHA1()` in SQL. SQLite does not provide a built-in
`SHA1()` function, so `src/server.c` now computes the same lower-case SHA1 hex
digest in C before inserting or comparing user passwords.

This preserves the existing password storage format for newly created SQLite
rows.

## Runtime arguments

The `-d` argument now means SQLite database file path.

Default:

```sh
./rftgserver -d rftg.sqlite
```

The old MySQL options are still accepted for compatibility but ignored:

```sh
-host
-u
-pw
```

The help output was updated to describe this behavior.

## Build system changes

`src/configure.ac` now checks for:

- `sqlite3.h`
- `sqlite3_open` in `-lsqlite3`

`src/Makefile.am` now links:

```make
rftgserver_LDADD = -lsqlite3 -lpthread
```

instead of:

```make
rftgserver_LDADD = -lmysqlclient -lpthread
```

The generated autotools files were refreshed with `autoreconf -fi`.

## Schema changes

`sql/server-schema.sql` was converted from MySQL syntax to SQLite syntax.

Notable changes:

- `AUTO_INCREMENT` became `INTEGER PRIMARY KEY AUTOINCREMENT`
- MySQL `ENUM` columns became `TEXT`
- MySQL database/user/grant statements were removed
- MySQL comments were replaced with SQLite-compatible comments
- `seed.gid` is now the primary key
- `choices` keeps `PRIMARY KEY (gid, uid)`

## Verification

The server was configured and built with:

```sh
cd src
./configure --enable-server
make rftgserver
```

Both commands completed successfully.

The final link command used SQLite:

```sh
gcc ... -o rftgserver ... -lsqlite3 -lpthread -lm
```

`ldd ./rftgserver` showed `libsqlite3.so.0` and no `mysqlclient` dependency.

`./rftgserver -h` printed the updated SQLite-oriented help text.

A short startup test with a temporary database file reached database creation
before the sandbox blocked socket creation:

```sh
timeout 2 ./rftgserver -d /tmp/rftg-rftgserver-test.sqlite -p 17409
```

The sandbox returned:

```text
socket: Operation not permitted
```

The SQLite database file was still created, confirming that the database open
and schema initialization path ran before the sandbox socket restriction.

## Remaining warnings

The build still emits existing `-Wformat-overflow` warnings in `server.c` and
`ai.c`. They are unrelated to the MySQL-to-SQLite migration and did not prevent
`rftgserver` from compiling or linking.

