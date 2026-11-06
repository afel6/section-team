# Help desk

A JSON API for users, tickets, comments and an audit log, on one SQLite file.

    ADMIN_PASSWORD='a long password' PORT=3000 DB_FILE=helpdesk.db npm start

`ADMIN_PASSWORD` (12 to 200 characters) is read only when the database has no user yet.

The dashboard is at `/`; `GET /api/reports/summary` and `GET /api/reports/chart.svg` take `priority`, `from`, `to` and (for admins) `created_by`.

`MODEL_URL` (http or https) enables `POST /api/tickets/<id>/summary` and `/category`; without it they answer 503.
