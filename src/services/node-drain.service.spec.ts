import { assert } from "chai";
import { MockKubeClient } from "../clients/mock/mock-kube.client";
import { Node } from "../domain/kube/node.model";
import { NodeDrainService } from "./node-drain.service";

describe("NodeDrainService", () => {

  it("Cordon empty node", (done) => {
    // Arrange
    let node: Node = {
      metadata: {
        name: "slave01"
      },
      spec: {
        unschedulable: true
      }
    };

    let mockClient = MockKubeClient
      .patch("/api/v1/nodes/slave01").responseBody({})
      .get("/api/v1/nodes/slave01").responseBody(node)
      .get("/api/v1/pods").responseBody({ items: [] })
      .build();

    let nodeDrainService = new NodeDrainService(mockClient);

    // Act
    nodeDrainService.processNode(node).then(() => {
      try {
        // Assert
        done();
      } catch (e) {
        done(e);
      }
    }, error => done(error));
  });

  it("Uncordon empty node", (done) => {
    // Arrange
    let node: Node = {
      metadata: {
        name: "slave01"
      },
      spec: {
        unschedulable: false
      }
    };

    let mockClient = MockKubeClient
      .patch("/api/v1/nodes/slave01").responseBody({})
      .build();

    let nodeDrainService = new NodeDrainService(mockClient);

    // Act
    nodeDrainService.processNode(node).then(() => {
      try {
        // Assert
        done();
      } catch (e) {
        done(e);
      }
    }, error => done(error));
  });

  it("Scale Down pod on schedulable node", (done) => {
    // Arrange
    let node: Node = {
      metadata: {
        name: "slave01",
        annotations: {}
      },
      spec: {
        unschedulable: false
      }
    };
    node.metadata.annotations[NodeDrainService.ANNOTATION_NAME] = JSON.stringify({
      deploymentConfigs: [
        {
          name: "customer-service",
          namespace: "my-project",
          original: 1,
          current: 2,
          pods: ["customer-service-12-abcd"]
        }]
    });

    let mockClient = MockKubeClient
      .patch("/api/v1/nodes/slave01").responseBody({})
      .get("/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service/scale").responseBody({
        metadata: {
          name: "customer-service",
          namespace: "my-project"
        },
        spec: {
          replicas: 2
        }
      })
      .put("/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service/scale").responseBody({
        metadata: {
          name: "customer-service",
          namespace: "my-project"
        },
        spec: {
          replicas: 1
        }
      }).build();

    let nodeDrainService = new NodeDrainService(mockClient);

    // Act
    nodeDrainService.processNode(node).then(() => {
      try {
        assert.deepEqual({
          metadata: {
            name: "customer-service",
            namespace: "my-project"
          },
          spec: {
            replicas: 1
          }
        }, mockClient.bodyOf("put", "/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service/scale"));
        done();
      } catch (e) {
        done(e);
      }
    }, error => done(error));
  });

  it("Scale Down multiple pods on schedulable node", (done) => {
    // Arrange
    let node: Node = {
      metadata: {
        name: "slave01",
        annotations: {}
      },
      spec: {
        unschedulable: false
      }
    };
    node.metadata.annotations[NodeDrainService.ANNOTATION_NAME] = JSON.stringify({
      deploymentConfigs: [
        {
          name: "customer-service",
          namespace: "my-project",
          original: 1,
          current: 2,
          pods: ["customer-service-12-abcd"]
        },
        {
          name: "order-service",
          namespace: "my-test",
          original: 2,
          current: 3,
          pods: ["order-service-11-abcd"]
        }]
    });

    let mockClient = MockKubeClient
      .patch("/api/v1/nodes/slave01").responseBody({})
      .get("/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service/scale").responseBody({
        metadata: {
          name: "customer-service",
          namespace: "my-project"
        },
        spec: {
          replicas: 2
        }
      })
      .put("/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service/scale").responseBody({
        metadata: {
          name: "customer-service",
          namespace: "my-project"
        },
        spec: {
          replicas: 1
        },
      })
      .get("/oapi/v1/namespaces/my-test/deploymentconfigs/order-service/scale").responseBody({
        metadata: {
          name: "order-service",
          namespace: "my-test"
        },
        spec: {
          replicas: 3
        }
      })
      .put("/oapi/v1/namespaces/my-test/deploymentconfigs/order-service/scale").responseBody({
        metadata: {
          name: "order-service",
          namespace: "my-test"
        },
        spec: {
          replicas: 2
        },
      }).build();

    let nodeDrainService = new NodeDrainService(mockClient);

    // Act
    nodeDrainService.processNode(node).then(() => {
      try {
        assert.deepEqual({
          metadata: {
            name: "customer-service",
            namespace: "my-project"
          },
          spec: {
            replicas: 1
          }
        }, mockClient.bodyOf("put", "/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service/scale"));
        assert.deepEqual({
          metadata: {
            name: "order-service",
            namespace: "my-test"
          },
          spec: {
            replicas: 2
          }
        }, mockClient.bodyOf("put", "/oapi/v1/namespaces/my-test/deploymentconfigs/order-service/scale"));
        done();
      } catch (e) {
        done(e);
      }
    }, error => done(error));
  });

  it("Scale Down multiple pods on schedulable node", (done) => {
    // Arrange
    let node: Node = {
      metadata: {
        name: "slave01",
        annotations: {}
      },
      spec: {
        unschedulable: false
      }
    };
    node.metadata.annotations[NodeDrainService.ANNOTATION_NAME] = JSON.stringify({
      deploymentConfigs: [
        {
          name: "customer-service",
          namespace: "my-project",
          original: 1,
          current: 2,
          pods: ["customer-service-12-abcd"]
        },
        {
          name: "order-service",
          namespace: "my-test",
          original: 2,
          current: 3,
          pods: ["order-service-11-abcd"]
        }]
    });

    let mockClient = MockKubeClient
      .patch("/api/v1/nodes/slave01").responseBody({})
      .get("/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service/scale").responseBody({
        metadata: {
          name: "customer-service",
          namespace: "my-project"
        },
        spec: {
          replicas: 2
        }
      })
      .put("/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service/scale").responseBody({
        metadata: {
          name: "customer-service",
          namespace: "my-project"
        },
        spec: {
          replicas: 1
        },
      })
      .get("/oapi/v1/namespaces/my-test/deploymentconfigs/order-service/scale").responseBody({
        metadata: {
          name: "order-service",
          namespace: "my-test"
        },
        spec: {
          replicas: 3
        }
      })
      .put("/oapi/v1/namespaces/my-test/deploymentconfigs/order-service/scale").responseBody({
        metadata: {
          name: "order-service",
          namespace: "my-test"
        },
        spec: {
          replicas: 2
        },
      }).build();

    let nodeDrainService = new NodeDrainService(mockClient);

    // Act
    nodeDrainService.processNode(node).then(() => {
      try {
        assert.deepEqual({
          metadata: {
            name: "customer-service",
            namespace: "my-project"
          },
          spec: {
            replicas: 1
          }
        }, mockClient.bodyOf("put", "/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service/scale"));
        assert.deepEqual({
          metadata: {
            name: "order-service",
            namespace: "my-test"
          },
          spec: {
            replicas: 2
          }
        }, mockClient.bodyOf("put", "/oapi/v1/namespaces/my-test/deploymentconfigs/order-service/scale"));
        done();
      } catch (e) {
        done(e);
      }
    }, error => done(error));
  });

  it("Scale up multiple pods on unschedulable node", (done) => {
    // Arrange
    let node: Node = {
      metadata: {
        name: "slave01",
        annotations: {}
      },
      spec: {
        unschedulable: true
      }
    };

    let mockClient = MockKubeClient
      .get("/api/v1/pods").responseBody({
        items: [
          {
            metadata: {
              name: "customer-service-12-abc",
              namespace: "my-project",
              annotations: {
                "openshift.io/deployment-config.name": "customer-service"
              }
            }
          },
          {
            metadata: {
              name: "order-service-5-def",
              namespace: "my-test",
              annotations: {
                "openshift.io/deployment-config.name": "order-service"
              }
            }
          }]
      })
      .get("/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service").responseBody({
        metadata: {
          name: "customer-service",
          namespace: "my-project"
        },
        spec: {
          replicas: 1
        },
        status: {
          replicas: 1,
          readyReplicas: 1
        }
      })
      .get("/oapi/v1/namespaces/my-test/deploymentconfigs/order-service").responseBody({
        metadata: {
          name: "order-service",
          namespace: "my-test"
        },
        spec: {
          replicas: 2
        },
        status: {
          replicas: 2,
          readyReplicas: 2
        }
      })
      .put("/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service/scale").responseBody({
        metadata: {
          name: "customer-service",
          namespace: "my-project"
        },
        spec: {
          replicas: 2
        },
      })
      .get("/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service/scale").responseBody({
        metadata: {
          name: "customer-service",
          namespace: "my-project"
        },
        spec: {
          replicas: 1
        },
      })
      .patch("/api/v1/nodes/slave01").responseBody({})
      .get("/api/v1/nodes/slave01").responseBody(node)
      .build();

    let nodeDrainService = new NodeDrainService(mockClient);

    // Act
    nodeDrainService.processNode(node).then(() => {
      try {
        assert.deepEqual({
          metadata: {
            name: "customer-service",
            namespace: "my-project"
          },
          spec: {
            replicas: 2
          }
        }, mockClient.bodyOf("put", "/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service/scale"));
        done();
      } catch (e) {
        done(e);
      }
    }, error => done(error));
  });

  it("Scale down pods after deleted on unschedulable node", (done) => {
    // Arrange
    let node: Node = {
      metadata: {
        name: "slave01",
        annotations: {}
      },
      spec: {
        unschedulable: true
      }
    };
    node.metadata.annotations[NodeDrainService.ANNOTATION_NAME] = JSON.stringify({
      deploymentConfigs: [
        {
          name: "customer-service",
          namespace: "my-project",
          original: 1,
          desired: 2,
          current: 2,
          pods: ["customer-service-12-abcd"]
        }]
    });

    let mockClient = MockKubeClient
      .get("/api/v1/pods").responseBody({
        items: [
          {
            metadata: {
              name: "customer-service-12-abcd",
              namespace: "my-project",
              annotations: {
                "openshift.io/deployment-config.name": "customer-service"
              }
            }
          }]
      })
      .get("/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service").responseBody({
        metadata: {
          name: "customer-service",
          namespace: "my-project"
        },
        spec: {
          replicas: 2
        },
        status: {
          replicas: 2,
          readyReplicas: 2
        }
      })
      .get("/api/v1/namespaces/my-project/pods/customer-service-12-abcd").responseBody({
        metadata: {
          name: "customer-service-12-abcd",
          namespace: "my-project"
        },
        spec: {},
        status: {
          phase: "Complete"
        }
      })
      .put("/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service/scale").responseBody({
        metadata: {
          name: "customer-service",
          namespace: "my-project"
        },
        spec: {
          replicas: 1
        },
      })
      .get("/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service/scale").responseBody({
        metadata: {
          name: "customer-service",
          namespace: "my-project"
        },
        spec: {
          replicas: 2
        },
      })
      .patch("/api/v1/nodes/slave01").responseBody({})
      .get("/api/v1/nodes/slave01").responseBody(node)
      .build();

    let nodeDrainService = new NodeDrainService(mockClient);

    // Act
    nodeDrainService.processNode(node).then(() => {
      try {
        assert.deepEqual({
          metadata: {
            name: "customer-service",
            namespace: "my-project"
          },
          spec: {
            replicas: 1
          }
        }, mockClient.bodyOf("put", "/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service/scale"));
        done();
      } catch (e) {
        done(e);
      }
    }, error => done(error));
  });

  it("Delete pods after grace period on unschedulable node", (done) => {
    // Arrange
    let node: Node = {
      metadata: {
        name: "slave01",
        annotations: {}
      },
      spec: {
        unschedulable: true
      }
    };
    node.metadata.annotations[NodeDrainService.ANNOTATION_NAME] = JSON.stringify({
      deploymentConfigs: [
        {
          name: "customer-service",
          namespace: "my-project",
          original: 1,
          desired: 2,
          current: 2,
          readyTime: 0,
          pods: ["customer-service-12-abcd"]
        }]
    });

    let mockClient = MockKubeClient
      .get("/api/v1/pods").responseBody({
        items: [
          {
            metadata: {
              name: "customer-service-12-abcd",
              namespace: "my-project",
              annotations: {
                "openshift.io/deployment-config.name": "customer-service"
              }
            }
          }]
      })
      .get("/oapi/v1/namespaces/my-project/deploymentconfigs/customer-service").responseBody({
        metadata: {
          name: "customer-service",
          namespace: "my-project"
        },
        spec: {
          replicas: 2
        },
        status: {
          replicas: 2,
          readyReplicas: 2
        }
      })
      .get("/api/v1/namespaces/my-project/pods/customer-service-12-abcd").responseBody({
        metadata: {
          name: "customer-service-12-abcd",
          namespace: "my-project"
        },
        spec: {},
        status: {
          phase: "Running"
        }
      })
      .delete("/api/v1/namespaces/my-project/pods/customer-service-12-abcd").responseBody({
        metadata: {
          name: "customer-service-12-abcd",
          namespace: "my-project"
        },
        spec: {},
        status: {
          phase: "Running"
        }
      })
      .patch("/api/v1/nodes/slave01").responseBody({})
      .get("/api/v1/nodes/slave01").responseBody(node)
      .build();

    let nodeDrainService = new NodeDrainService(mockClient);

    // Act
    nodeDrainService.processNode(node).then(() => {
      try {
        assert.deepEqual({}, mockClient.bodyOf("delete",
          "/api/v1/namespaces/my-project/pods/customer-service-12-abcd"));
        done();
      } catch (e) {
        done(e);
      }
    }, error => done(error));
  });

});
