@Library("PipelineLibrary_develop") _

import com.maxxton.pipeline.models.Project
import com.maxxton.pipeline.models.StageState

pipeline {
  agent {
    label 'maxxton-slave'
  }
  options {
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '2'))
  }
  environment {

    BITBUCKET = credentials("bitbucket")
    BITBUCKET_SSH = "bitbucket_ssh"
    BITBUCKET_URL = "https://stash.maxxton.com/rest"

    JIRA = credentials("jira")
    JIRA_URL = "https://support.maxxton.com"
    JIRA_PROJECT = "MXTS"

    JIRA_FIELD_STAGE = "customfield_12330"
    JIRA_FIELD_FIX_VERSION = "fixVersions"
    JIRA_FIELD_FIX_COMPONENT_VERSION = "customfield_12331"

    // Openshift clusters
    DOCKER_REGISTRY_INTERNAL = "172.30.226.108:5000"
    DOCKER_REGISTRY_DEVELOP = "docker-dev.maxxton.com"
    OPENSHIFT_DEVELOP_PROJECT = "mxtu"

    DOCKER_REGISTRY_PRODUCTION = "docker-prod.maxxton.com"
    OPENSHIFT_PRODUCTION_API = "https://mxt-ocmaster.newyse.maxxton:8443"
    OPENSHIFT_PRODUCTION_TOKEN = credentials("openshift_mxtu_prod_token")
    OPENSHIFT_PRODUCTION_PROJECT = "mxtu"
  }
  stages {
    stage('Initialize') {
      steps {
        script {
          sh "oc project ${env.OPENSHIFT_DEVELOP_PROJECT}"
          sshagent([env.BITBUCKET_SSH]) {
            sh "git config --global user.email \"serveruser@maxxton.com\""
            sh "git config --global user.name \"serveruser\""
            sh "git config --global push.default simple"
            sh "git fetch"
          }
          stash includes: '**', name: 'sources'
        }
      }
    }
    stage('Check build status') {
      when {
        allOf {
          not {
            branch 'PR-*'
          }
        }
      }
      steps {
        script {
          bitbucket.notifyStage("Check build status") { stage ->
            context.imageRef = findImageFromSameCommit(env.OPENSHIFT_DEVELOP_PROJECT)
          }
        }
      }
    }
    stage('Build') {
      steps {
        script {
          bitbucket.notifyStage("Build") { stage ->
            def info = getRepositoryInfo(env.CHANGE_URL)
            def tag = getTag()
            def commitHash = sh(returnStdout: true, script: "git rev-parse --short HEAD").trim()

            if (context.shouldBuild()) {
              // Prepare build
              def params = map([
                  'NAME': info.name,
                  'TAG' : commitHash,
              ])
              ocCreateTemplate("build/templates/build-template.yml", env.OPENSHIFT_DEVELOP_PROJECT, params);

              // Start build
              try {
                sh "oc start-build ${info.name}-${commitHash} --from-dir=. --follow --wait  -n ${env.OPENSHIFT_DEVELOP_PROJECT}"
              } finally {
                try {
                  // Cleanup build
                  sh "oc delete bc/${info.name}-${commitHash} -n ${env.OPENSHIFT_DEVELOP_PROJECT}"
                } catch (e) {
                }
              }

              // Tag
              sh "oc tag ${env.OPENSHIFT_DEVELOP_PROJECT}/${info.name}:${commitHash} ${env.OPENSHIFT_DEVELOP_PROJECT}/${info.name}:${tag}"

              def parentRefs = sh(returnStdout: true, script: "git log --pretty=%p -n 1").trim().split(" ")
              if (parentRefs.length >= 2) {
                sh "oc tag ${env.OPENSHIFT_DEVELOP_PROJECT}/${info.name}:${commitHash} ${env.OPENSHIFT_DEVELOP_PROJECT}/${info.name}:${parentRefs[0]}-${parentRefs[1]}"
              }
            } else {
              // Promote
              sh "oc tag ${env.OPENSHIFT_DEVELOP_PROJECT}/${info.name}:${context.imageRef} ${env.OPENSHIFT_DEVELOP_PROJECT}/${info.name}:${tag}"
              if (!commitHash.equals(context.imageRef)) {
                sh "oc tag ${env.OPENSHIFT_DEVELOP_PROJECT}/${info.name}:${context.imageRef} ${env.OPENSHIFT_DEVELOP_PROJECT}/${info.name}:${commitHash}"
              }
            }
          }
        }
      }
    }
    stage('Tag') {
      when {
        allOf {
          branch 'master'
        }
      }
      steps {
        script {
          bitbucket.notifyStage("Tag") { stage ->
            script {
              def releaseType = 'minor'
              sshagent([BITBUCKET_SSH]) {
                setTag(releaseType)
              }
            }
          }
        }
      }
    }
    stage('Import image') {
      when {
        allOf {
          anyOf {
            branch 'master'
          }
        }
      }
      steps {
        script {
          bitbucket.notifyStage("Import image") { stage ->
            def info = getRepositoryInfo(env.CHANGE_URL)
            def tag = getTag()
            def gitRef = getGitRef()
            if (tag == null) {
              stage.desc = "missing ticket number"
              stage.state = StageState.WARNING
              return
            }
            def commitHash = sh(returnStdout: true, script: "git rev-parse --short HEAD").trim()

            // Pull image from develop
            def username = "${OPENSHIFT_DEVELOP_PROJECT}/jenkins"
            def token = sh (script: "oc whoami -t", returnStdout: true).trim()
            retry(5){
              sleep 3
              sh "docker login -u ${username} -p ${token} ${DOCKER_REGISTRY_DEVELOP}"
              sh "docker pull ${DOCKER_REGISTRY_DEVELOP}/${OPENSHIFT_DEVELOP_PROJECT}/${info.name}:${commitHash}"
            }

            // Push image to production
            def ocProject = ocLogin()
            remoteUsername = "${ocProject}/remote-deployer"
            remoteToken = sh (script: "oc whoami -t", returnStdout: true).trim()
            sh "docker tag ${DOCKER_REGISTRY_DEVELOP}/${OPENSHIFT_DEVELOP_PROJECT}/${info.name}:${commitHash} ${DOCKER_REGISTRY_PRODUCTION}/${ocProject}/${info.name}:${commitHash}"
            retry(5){
              sleep 3
              sh "docker login -u ${remoteUsername} -p ${remoteToken} ${DOCKER_REGISTRY_PRODUCTION}"
              sh "docker push ${DOCKER_REGISTRY_PRODUCTION}/${ocProject}/${info.name}:${commitHash}"
            }

            // Tag stage, eg. acc or prod
            sh "oc tag ${ocProject}/${info.name}:${commitHash} ${ocProject}/${info.name}:${tag} -n ${ocProject}"
            // Tag git version, eg. v1.5.0 or acc-v2017.30.1
            if (!gitRef.equals(tag)) {
              sh "oc tag ${ocProject}/${info.name}:${commitHash} ${ocProject}/${info.name}:${gitRef} -n ${ocProject}"
            }
          }
        }
      }
    }
    stage('Deploy') {
      steps {
        script {
          bitbucket.notifyStage("Deploy") { stage ->
            def info = getRepositoryInfo(env.CHANGE_URL)
            def ocProject = ocLogin()
            def tag = getTag()
            if (tag == null) {
              stage.desc = "missing ticket number"
              stage.state = StageState.WARNING
              return
            }
            def deployEnv = 'dev'
            if (tag.equals('prod')) {
              deployEnv = tag
            }
            def dcName = info.pr != null ? "${info.name}-${tag}" : info.name;

            // Prepare deployment
            def params = map([
                NAME           : dcName,
                ORIGINAL_NAME  : info.name,
                TAG            : tag,
                NAMESPACE      : ocProject,
                DOCKER_REGISTRY: deployEnv == "dev" ? env.DOCKER_REGISTRY_INTERNAL : env.DOCKER_REGISTRY_PRODUCTION
            ])
            if (info.pr) {
              params.BB_PROJECT = info.pr.bitbucketProject
              params.BB_REPO = info.pr.bitbucketRepo
              params.BB_PR = info.pr.bitbucketPullRequestId
            }
            ocCreateTemplate("build/templates/deploy-template.yml", ocProject, params);

            // Prepare services
            try {
              sh "oc get svc/${dcName} -n ${ocProject}"
            } catch (e) {
              echo "Service not exposed"
              def serviceParams = map([
                  NAME         : dcName,
                  ORIGINAL_NAME: info.name,
                  TAG          : tag
              ])
              if (info.pr) {
                serviceParams.BB_PROJECT = info.pr.bitbucketProject
                serviceParams.BB_REPO = info.pr.bitbucketRepo
                serviceParams.BB_PR = info.pr.bitbucketPullRequestId
              }
              ocCreateTemplate("build/templates/service-template.yml", ocProject, serviceParams);
            }

            // Deploy
            sh "oc rollout status dc/${dcName} -n ${ocProject}"
          }
        }
      }
    }
    stage('Update tickets') {
      when {
        allOf {
          anyOf {
            branch 'develop'
            branch 'master'
          }
          not {
            expression { context.skipAll }
          }
        }
      }
      steps {
        script {
          bitbucket.notifyStage("Update tickets") { stage ->
            updateJiraFields()
          }
        }
      }
    }
  }
  post {
    success {
      script {
        bitbucket.setBuildSucceed()
      }
    }
    failure {
      script {
        bitbucket.setBuildFailed()
        if (env.CHANGE_URL == null) {
          notification.sendMail("mxtu", "s.hermans@maxxton.com")
        }
      }
    }
  }
}

