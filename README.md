# IncidentFlow: Cloud-Native Incident Management System for E-commerce

IncidentFlow watches a real online store, **Cartora**, and turns its failures into tracked incidents. When a payment gateway times out, checkout breaks or a page slows down, IncidentFlow opens an incident by itself, works out the severity (P1 to P4), adds up the failed orders and the revenue at risk, and lets the on-call team take it from *open* to *resolved* with a full timeline, SLA timers and MTTR/MTTA metrics.

The whole system is built, tested and deployed on AWS by a Jenkins pipeline, on infrastructure created with Terraform and configured with Ansible.

| Part | What it is |
|---|---|
| `/` | Cartora storefront: catalogue, search, product pages, cart, checkout (UPI / card / COD), order tracking, "Report a problem" |
| `/ops` | IncidentFlow console: overview KPIs, incident list and detail, declare incident, services and fault injection |
| `/status` | Public status page fed by open P1/P2 incidents |
| `/health`, `/metrics` | Health check (with build version) and Prometheus-style metrics |

## How incidents are detected

1. **Checkout failures**: every failed order opens or updates an incident (grouped by fingerprint) with failed-order count and revenue at risk.
2. **Service monitor**: a rolling window of the last 20 calls per service. 30% or more errors, or a p95 latency above 1,200 ms, opens an incident.
3. **Customers**: the "Report a problem" button on the store.
4. **Jenkins**: a failed pipeline records a P3 deployment incident while the previous version keeps serving traffic.
5. **People**: on-call staff can declare an incident from the console.

The **Services & fault injection** page switches any service to *degraded* or *down*, so detection can be shown live.

## Monitoring (Prometheus + Grafana)

The app exposes Prometheus metrics at `/metrics` (service health, error rate, p95 latency, open incidents, revenue at risk, agent fixes/escalations, tickets, orders, MTTR/MTTA).
The Ansible `monitoring` role runs **Prometheus** (scrapes every 5 s, kept on localhost) and **Grafana** on port **3000** with the data source and the
*IncidentFlow - Store Monitoring* dashboard provisioned automatically. Grafana opens as a read-only viewer; the admin password is in `ansible/keys/grafana-admin-password.txt`.

## Repository layout

```
app/                 Node.js 20 + Express application, tests and Dockerfile
  src/               catalogue, severity engine, incident service + monitor, JSON store
  public/            storefront, ops console and status page (HTML/CSS/JS)
  test/              node:test unit and API tests
Jenkinsfile          CI/CD pipeline (tests, audit, build, smoke test, deploy, verify)
terraform/           EC2, security group, key pair, Elastic IP, Ansible inventory
ansible/             roles: common (packages, swap), docker, jenkins (JCasC)
docker-compose.yml   local run
```

## Run locally

```bash
cd app && npm install && npm test && npm start     # http://localhost:3000
# or
docker compose up --build                          # http://localhost:8080
```

Local ops login: `admin` / `incidentflow` (override with `OPS_USER` / `OPS_PASSWORD`).

## Deploy to AWS (Learner Lab)

```bash
# 1. AWS credentials from Learner Lab -> AWS Details -> AWS CLI, into ~/.aws/credentials
aws sts get-caller-identity

# 2. Infrastructure
cd terraform && terraform init && terraform plan && terraform apply

# 3. Server configuration
cd ../ansible && ansible-playbook ping.yml && ansible-playbook site.yml

# 4. Jenkins (http://<ip>:8080) builds incidentflow-pipeline automatically within 2 minutes.

# Clean up when done
cd ../terraform && terraform destroy
```

Secrets (SSH key, Jenkins admin password, ops password, session key) are generated into `ansible/keys/`, which is git-ignored.
