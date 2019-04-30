
@Library("PipelineLibrary") _

import com.maxxton.pipeline.models.Project
import com.maxxton.pipeline.models.StageState

def loadEnvs(Closure closure) {
  env.BITBUCKET = credentials("bitbucket")
  env.BITBUCKET_SSH = "bitbucket_ssh"
  env.BITBUCKET_URL = "https://stash.maxxton.com/rest"

  // Google Kubernetes clusters
  env.GCE_MAXXTON_CREDENTIALS_ID = "gcr:${GCE_MAXXTON_PROJECT_ID}"
  env.GCE_MAXXTON_DOCKER_REGISTRY = "eu.gcr.io"

  closure()
}

node("master") {

  loadEnvs {
    try {

      stage("Init Build") {
        //Stop previous builds
        def info = getRepositoryInfo(env.CHANGE_URL)
        stopPreviousBuilds(list([]))
      }

    } catch (e) {
      bitbucket.setBuildFailed()
      if (env.CHANGE_URL == null) {
        notification.sendMail("mxts", "mxts@maxxton.com")
      }
      throw e;
    }
  }

}

node("mcms-slave") {
  timeout(15) {
    loadEnvs {
      try {
        properties([
            buildDiscarder(logRotator(numToKeepStr: '2'))
        ])

        def info
        def tag

        stage("Init Workspace") {
          // Initialize stuff
          sshagent([env.BITBUCKET_SSH]) {
            sh "chmod 644 ~/.ssh/config || true"
            sh "chmod 644 ~/.ssh/config || true"
            checkout scm

            info = getRepositoryInfo(env.CHANGE_URL)
            tag = env.BRANCH_NAME
          }
        }

        stage("Build Docker image") {
          bitbucket.notifyStage("Build Docker image") { stage ->
            sh "docker build -t ${info.name}:${tag} ."
          }
        }

        stage("Push Docker image") {
          bitbucket.notifyStage("Push Docker image") { stage ->
            def gceDockerRegistry = GCE_MAXXTON_DOCKER_REGISTRY
            def gceCredentialsId = GCE_MAXXTON_CREDENTIALS_ID
            def gceProjectId = GCE_MAXXTON_PROJECT_ID

            // Push image to gcr.io
            retry(3) {
              try {
                timeout(5) {
                  docker.withRegistry("https://${gceDockerRegistry}", gceCredentialsId) {
                    sh "docker tag ${info.name}:${tag} ${gceDockerRegistry}/${gceProjectId}/${info.name}:${tag}"
                    docker.image("${gceDockerRegistry}/${gceProjectId}/${info.name}:${tag}").push()
                  }
                }
              } catch (e) {
                sleep 10
                throw e;
              }
            }
          }
        }

        bitbucket.setBuildSucceed()
      } catch (e) {
        bitbucket.setBuildFailed()
        if (env.CHANGE_URL == null) {
          notification.sendMail("mxts", "mxts@maxxton.com")
        }
        throw e;
      }
    }

  }
}