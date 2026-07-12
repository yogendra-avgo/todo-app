import os
import random

from locust import HttpUser, task, between

# BASE_PATH mirrors the app's own BASE_PATH env var. In k8s the app is
# reverse-proxied under /app via a Gateway API HTTPRoute, so Locust must hit
# the same prefix even when talking to the Service directly. In docker-compose
# the app isn't reverse-proxied, so BASE_PATH is left unset.
BASE_PATH = os.environ.get("BASE_PATH", "").rstrip("/")

SAMPLE_TASKS = [
    "Review Q2 regional sales performance targets",
    "Approve pending vendor payments and invoice batches",
    "Prepare agenda for the upcoming quarterly board meeting",
    "Finalize job descriptions for senior engineering roles",
    "Coordinate travel itinerary and hotel bookings for client visit",
]


class TodoAppUser(HttpUser):
    wait_time = between(1, 3)

    def on_start(self):
        # Make sure there is always some data to page through / toggle.
        self.client.post(f"{BASE_PATH}/api/todos/seed")

    @task(5)
    def view_homepage(self):
        self.client.get(f"{BASE_PATH}/" if BASE_PATH else "/")

    @task(3)
    def create_task(self):
        task_text = random.choice(SAMPLE_TASKS)
        self.client.post(f"{BASE_PATH}/api/todos", data={"task": task_text})

    @task(3)
    def toggle_task(self):
        todo_id = random.randint(1, 20)
        self.client.post(f"{BASE_PATH}/api/todos/{todo_id}/toggle")

    @task(1)
    def reseed(self):
        self.client.post(f"{BASE_PATH}/api/todos/seed")

    @task(1)
    def scrape_metrics(self):
        # /metrics is always unprefixed, even when BASE_PATH is set.
        self.client.get("/metrics")
