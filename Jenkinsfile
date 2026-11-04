// IncidentFlow CI/CD pipeline
// Runs on the Jenkins container on EC2. Jenkins talks to the host Docker engine
// through the mounted Docker socket, so images are built and run on the same server.
pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '10'))
    timeout(time: 20, unit: 'MINUTES')
  }

  triggers { pollSCM('H/2 * * * *') }

  environment {
    APP       = 'incidentflow'
    HOST      = 'host.docker.internal'
    LIVE_PORT = '80'
    TEST_PORT = '8081'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        script {
          env.TAG = "v${env.BUILD_NUMBER}-" + sh(returnStdout: true, script: 'git rev-parse --short HEAD').trim()
        }
        sh 'git log -1 --pretty="Commit %h by %an: %s"'
      }
    }

    stage('Unit Tests') {
      steps {
        sh '''
          docker run --rm -u 1000:1000 -e npm_config_cache=/tmp/.npm -v "$WORKSPACE/app:/app" -w /app node:20-alpine \
            sh -c "npm ci --no-audit --no-fund && npm test"
        '''
      }
    }

    stage('Dependency Audit') {
      steps {
        sh '''
          docker run --rm -u 1000:1000 -e npm_config_cache=/tmp/.npm -v "$WORKSPACE/app:/app" -w /app node:20-alpine \
            npm audit --omit=dev --audit-level=high
        '''
      }
    }

    stage('Build Docker Image') {
      steps {
        sh '''
          docker build --pull -t $APP:$TAG -t $APP:latest app
          docker images $APP --format "table {{.Repository}}\\t{{.Tag}}\\t{{.Size}}\\t{{.CreatedSince}}"
        '''
      }
    }

    stage('Smoke Test Container') {
      steps {
        sh '''
          docker rm -f $APP-test >/dev/null 2>&1 || true
          docker run -d --name $APP-test -p $TEST_PORT:3000 -e APP_VERSION=$TAG -e DATA_FILE=/tmp/test.json \
            -e OPS_USER=smoke -e OPS_PASSWORD=smoke-pass $APP:$TAG
          for i in $(seq 1 20); do curl -fs http://$HOST:$TEST_PORT/health && break; sleep 2; done
          echo
          curl -fs http://$HOST:$TEST_PORT/health | grep -q '"status":"ok"'
          curl -fs http://$HOST:$TEST_PORT/api/products | grep -q '"id":"p101"'
          # An order must go through when every service is healthy
          curl -fs -X POST -H "Content-Type: application/json" \
            -d '{"items":[{"id":"p101","qty":1}],"customer":{"name":"Jenkins","email":"ci@cartora.test","phone":"9000000000","address":"CI","city":"Chennai","pincode":"603203"},"payment":"cod"}' \
            http://$HOST:$TEST_PORT/api/orders | grep -q '"status":"confirmed"'
          # The ops API must be protected
          test "$(curl -s -o /dev/null -w '%{http_code}' http://$HOST:$TEST_PORT/api/incidents)" = "401"
          echo "Smoke test passed"
        '''
      }
      post { always { sh 'docker rm -f $APP-test >/dev/null 2>&1 || true' } }
    }

    stage('Deploy to EC2') {
      steps {
        withCredentials([
          usernamePassword(credentialsId: 'incidentflow-ops', usernameVariable: 'OPS_USER', passwordVariable: 'OPS_PASSWORD'),
          string(credentialsId: 'incidentflow-session-secret', variable: 'SESSION_SECRET')
        ]) {
          sh '''
            docker volume create $APP-data >/dev/null
            docker rm -f $APP >/dev/null 2>&1 || true
            docker run -d --name $APP --restart unless-stopped -p $LIVE_PORT:3000 \
              -e APP_VERSION=$TAG -e OPS_USER="$OPS_USER" -e OPS_PASSWORD="$OPS_PASSWORD" -e SESSION_SECRET="$SESSION_SECRET" \
              -v $APP-data:/data $APP:$TAG
            for i in $(seq 1 20); do curl -fs http://$HOST:$LIVE_PORT/health && break; sleep 2; done
            echo
            docker ps --filter name=^/$APP$ --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"
          '''
        }
      }
    }

    stage('Verify Deployment') {
      steps {
        sh '''
          curl -fs http://$HOST:$LIVE_PORT/health | tee health.json
          echo
          grep -q "$TAG" health.json
          curl -fs http://$HOST:$LIVE_PORT/ | grep -q "cartora"
          echo "IncidentFlow $TAG is live on port $LIVE_PORT"
        '''
      }
    }
  }

  post {
    success {
      sh 'docker image prune -f --filter "until=24h" >/dev/null || true'
    }
    failure {
      // A failed release is itself an incident: record it in IncidentFlow
      // (the previous version is still serving traffic).
      withCredentials([usernamePassword(credentialsId: 'incidentflow-ops', usernameVariable: 'OPS_USER', passwordVariable: 'OPS_PASSWORD')]) {
        sh '''
          curl -fs -c /tmp/if.cookies -H "Content-Type: application/json" \
            -d "{\\"username\\":\\"$OPS_USER\\",\\"password\\":\\"$OPS_PASSWORD\\"}" http://$HOST:$LIVE_PORT/api/auth/login >/dev/null \
          && curl -fs -b /tmp/if.cookies -H "Content-Type: application/json" \
            -d "{\\"title\\":\\"Deployment failed: Jenkins build #$BUILD_NUMBER\\",\\"description\\":\\"Pipeline $JOB_NAME failed. Previous version is still live. Logs: $BUILD_URL\\",\\"service\\":\\"storefront\\",\\"severity\\":\\"P3\\",\\"source\\":\\"pipeline\\",\\"reporter\\":\\"Jenkins\\"}" \
            http://$HOST:$LIVE_PORT/api/incidents || echo "IncidentFlow not reachable, incident not recorded"
          rm -f /tmp/if.cookies
        '''
      }
    }
  }
}
