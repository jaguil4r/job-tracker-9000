# Job Tracker 9000

A small job application tracker that runs on your own computer. It has no accounts, no cloud service and nothing to install except Python 3.

- See how many jobs are waiting on a reply, in conversation or still to apply to
- See which follow-ups are due
- Add, edit, delete, search and filter jobs
- Track pay, location, job link, resume used, contact, next step and notes

## Run it

```bash
git clone https://github.com/jaguil4r/job-tracker-9000.git
cd job-tracker-9000
python tracker.py
```

Then open http://127.0.0.1:8765. On Mac or Linux, you may need `python3` instead of `python`.

The tracker runs until you press Ctrl+C or close the terminal. Your jobs are still there the next time you start it.

## Your data

Your jobs are saved in `applications.json`, next to `tracker.py`, and the previous version is kept in `applications.backup.json`. Git ignores both files, so they aren't pushed to GitHub.

That also means GitHub doesn't back up your job list. Copy `applications.json` somewhere safe if you want a backup, and restart the tracker after restoring a copy.

To change the port or the data file, set `TRACKER_PORT` or `TRACKER_DATA` before starting the tracker.

## Files

- `tracker.py`: local server and JSON storage
- `index.html`, `app.js`, `styles.css`: the dashboard
